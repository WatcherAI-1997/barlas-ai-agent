import { randomUUID, timingSafeEqual } from "node:crypto";

import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { ModelProvider } from "./core/models.js";
import type { Database } from "./storage/database.js";

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
});

export interface AppDependencies {
  apiToken: string;
  database: Pick<Database, "ping" | "saveTurn" | "close">;
  modelProvider: ModelProvider;
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

  app.post("/v1/chat", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid chat request");
    }

    const conversationId = parsed.data.conversationId ?? randomUUID();
    const result = await dependencies.modelProvider.generate({
      userId: parsed.data.userId,
      conversationId,
      messages: parsed.data.messages,
    });

    await dependencies.database.saveTurn({
      userId: parsed.data.userId,
      conversationId,
      messages: parsed.data.messages,
      result,
    });

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
    };
  });

  app.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  return app;
}
