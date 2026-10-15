import { randomUUID, timingSafeEqual } from "node:crypto";

import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { ModelProvider } from "./core/models.js";
import { agentJobSchema } from "./jobs/agent-handler.js";
import { workflowJobSchema } from "./jobs/workflow-handler.js";
import type { SkillRegistry } from "./skills/registry.js";
import type { AgentStore } from "./storage/types.js";
import type { ToolExecutor } from "./tools/executor.js";

const chatBodySchema = z.object({
  userId: z.string().min(1).max(128),
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(100),
  taskClass: z.enum(["fast", "deep", "private"]).default("fast"),
});

const rememberBodySchema = z.object({
  userId: z.string().min(1).max(128),
  content: z.string().min(1).max(20_000),
  category: z.string().min(1).max(64).default("general"),
  importance: z.number().int().min(1).max(10).default(5),
});

const recallQuerySchema = z.object({
  userId: z.string().min(1).max(128),
  query: z.string().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      text: z.string().min(1).max(20_000),
      chat: z.object({ id: z.number().int() }),
      from: z.object({ id: z.number().int() }).optional(),
    })
    .optional(),
});

const toolExecutionSchema = z.object({
  userId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  toolInput: z.unknown(),
  summary: z.string().min(1).max(500),
});

const approvalParamsSchema = z.object({ id: z.string().uuid() });
const approvalDecisionSchema = z.object({
  userId: z.string().min(1).max(128),
  approved: z.boolean(),
});

const createJobSchema = z.discriminatedUnion("jobType", [
  z.object({
    userId: z.string().min(1).max(128),
    jobType: z.literal("agent.run"),
    input: agentJobSchema,
    scheduledFor: z.string().datetime().optional(),
  }),
  z.object({
    userId: z.string().min(1).max(128),
    jobType: z.literal("agent.workflow"),
    input: workflowJobSchema,
    scheduledFor: z.string().datetime().optional(),
  }),
]);

const listJobsSchema = z.object({
  userId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface AppDependencies {
  apiToken: string;
  database: AgentStore;
  modelProvider: ModelProvider;
  toolExecutor?: Pick<ToolExecutor, "listTools" | "execute" | "decide">;
  skillRegistry?: Pick<SkillRegistry, "list">;
  telegram?: {
    webhookSecret: string;
    client: { sendMessage(chatId: number, text: string): Promise<void> };
  };
  logger?: boolean;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.logger ?? false });
  await app.register(sensible);

  app.get("/health", async () => ({
    name: "Barlas AI Agent",
    status: "ok",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await dependencies.database.ping();
      return { name: "Barlas AI Agent", status: "ready" };
    } catch {
      return reply.serviceUnavailable("Database is not ready");
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!tokenMatches(dependencies.apiToken, suppliedToken)) {
      return reply.unauthorized("Invalid API token");
    }
  });

  const runChat = async (input: z.infer<typeof chatBodySchema>) => {
    const conversationId = input.conversationId ?? randomUUID();
    const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    const memories = latestUserMessage
      ? await dependencies.database.recall(input.userId, latestUserMessage.content, 5)
      : [];
    const memoryContext = memories.length > 0
      ? [{
          role: "system" as const,
          content: [
            "You are Barlas AI Agent. Use these user memories only when relevant:",
            ...memories.map((memory) => `- [${memory.category}] ${memory.content}`),
          ].join("\n"),
        }]
      : [];
    const result = await dependencies.modelProvider.generate({
      userId: input.userId,
      conversationId,
      messages: [...memoryContext, ...input.messages],
      taskClass: input.taskClass,
    });

    await dependencies.database.saveTurn({
      userId: input.userId,
      conversationId,
      messages: input.messages,
      result,
    });

    return { conversationId, result, memoriesUsed: memories.length };
  };

  app.post("/v1/chat", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid chat request");
    }

    const { conversationId, result, memoriesUsed } = await runChat(parsed.data);

    return {
      conversationId,
      message: {
        role: "assistant",
        content: result.text,
      },
      model: {
        provider: result.provider,
        name: result.model,
      },
      memoriesUsed,
    };
  });

  app.post("/v1/memory", async (request, reply) => {
    const parsed = rememberBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid memory request");
    const memory = await dependencies.database.remember(parsed.data);
    return reply.code(201).send({ memory });
  });

  app.get("/v1/memory/search", async (request, reply) => {
    const parsed = recallQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid memory search query");
    const memories = await dependencies.database.recall(
      parsed.data.userId,
      parsed.data.query,
      parsed.data.limit,
    );
    return { memories };
  });

  app.get("/v1/tools", async (_request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    return { tools: dependencies.toolExecutor.listTools() };
  });

  app.get("/v1/skills", async (_request, reply) => {
    if (!dependencies.skillRegistry) return reply.notFound();
    return { skills: dependencies.skillRegistry.list() };
  });

  app.post("/v1/tools/execute", async (request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    const parsed = toolExecutionSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid tool request");
    return dependencies.toolExecutor.execute(parsed.data);
  });

  app.post("/v1/approvals/:id/decision", async (request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    const params = approvalParamsSchema.safeParse(request.params);
    const body = approvalDecisionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid approval decision");
    try {
      return await dependencies.toolExecutor.decide({
        approvalId: params.data.id,
        userId: body.data.userId,
        approved: body.data.approved,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return reply.notFound(error.message);
      }
      throw error;
    }
  });

  app.post("/v1/jobs", async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid job request");
    const job = await dependencies.database.createJob({
      userId: parsed.data.userId,
      jobType: parsed.data.jobType,
      jobInput: parsed.data.input,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : new Date(),
    });
    await dependencies.database.appendAudit({
      userId: parsed.data.userId,
      eventType: "job.created",
      resourceType: "job",
      resourceId: job.id,
      details: { jobType: job.jobType, scheduledFor: job.scheduledFor },
    });
    return reply.code(201).send({ job });
  });

  app.get("/v1/jobs", async (request, reply) => {
    const parsed = listJobsSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid jobs query");
    const jobs = await dependencies.database.listJobs(parsed.data.userId, parsed.data.limit);
    return { jobs };
  });

  app.post("/channels/telegram/webhook", async (request, reply) => {
    if (!dependencies.telegram) return reply.notFound();
    const suppliedSecret = request.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof suppliedSecret !== "string" ||
      !tokenMatches(dependencies.telegram.webhookSecret, suppliedSecret)
    ) {
      return reply.unauthorized("Invalid Telegram webhook secret");
    }

    const parsed = telegramUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid Telegram update");
    if (!parsed.data.message) return { ok: true, ignored: true };

    const message = parsed.data.message;
    const { result } = await runChat({
      userId: `telegram:${message.from?.id ?? message.chat.id}`,
      messages: [{ role: "user", content: message.text }],
      taskClass: "fast",
    });
    await dependencies.telegram.client.sendMessage(message.chat.id, result.text);
    return { ok: true };
  });

  app.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  return app;
}
