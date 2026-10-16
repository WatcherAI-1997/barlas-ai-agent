import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ModelProvider } from "../src/core/models.js";
import { RuntimeGovernance } from "../src/governance/runtime.js";

const apiToken = "a".repeat(32);

function dependencies() {
  const modelProvider: ModelProvider = {
    name: "test",
    generate: vi.fn(async () => ({
      text: "Hello from Barlas AI Agent",
      provider: "test",
      model: "test-model",
      responseId: "response-test",
    })),
  };

  const database = {
    ping: vi.fn(async () => undefined),
    saveTurn: vi.fn(async () => undefined),
    remember: vi.fn(async (input: {
      userId: string;
      content: string;
      category: string;
      importance: number;
    }) => ({
      id: "00000000-0000-4000-8000-000000000001",
      ...input,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    recall: vi.fn(async () => []),
    createApproval: vi.fn(async (input: {
      userId: string;
      toolName: string;
      risk: "write" | "external" | "destructive";
      summary: string;
      toolInput: unknown;
    }) => ({
      id: "00000000-0000-4000-8000-000000000002",
      userId: input.userId,
      toolName: input.toolName,
      risk: input.risk,
      summary: input.summary,
      input: input.toolInput,
      status: "pending" as const,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    decideApproval: vi.fn(async () => null),
    markApprovalExecuted: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
    createJob: vi.fn(async (input: {
      userId: string;
      jobType: string;
      jobInput: unknown;
      scheduledFor: Date;
    }) => ({
      id: "00000000-0000-4000-8000-000000000003",
      userId: input.userId,
      jobType: input.jobType,
      input: input.jobInput,
      status: "queued" as const,
      scheduledFor: input.scheduledFor.toISOString(),
      attempts: 0,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    listJobs: vi.fn(async () => []),
    claimJobs: vi.fn(async () => []),
    completeJob: vi.fn(async () => true),
    failJob: vi.fn(async () => "failed" as const),
    close: vi.fn(async () => undefined),
  };

  return { modelProvider, database };
}

describe("Barlas AI Agent API", () => {
  it("returns branded health information", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: "Barlas AI Agent", status: "ok" });
    await app.close();
  });

  it("rejects chat requests without authorization", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("generates and stores an authorized chat response", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message.content).toBe("Hello from Barlas AI Agent");
    expect(response.json().memoriesUsed).toBe(0);
    expect(deps.database.saveTurn).toHaveBeenCalledOnce();
    await app.close();
  });

  it("stores explicit long-term memory", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        content: "The product name is Barlas AI Agent",
        category: "product",
        importance: 10,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().memory.content).toBe("The product name is Barlas AI Agent");
    expect(deps.database.remember).toHaveBeenCalledOnce();
    await app.close();
  });

  it("accepts authenticated Telegram updates", async () => {
    const deps = dependencies();
    const sendMessage = vi.fn(async () => undefined);
    const app = await buildApp({
      apiToken,
      ...deps,
      telegram: {
        webhookSecret: "t".repeat(32),
        client: { sendMessage },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/channels/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "t".repeat(32) },
      payload: {
        update_id: 1,
        message: {
          message_id: 2,
          text: "Hello",
          chat: { id: 42 },
          from: { id: 7 },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(42, "Hello from Barlas AI Agent");
    await app.close();
  });

  it("creates durable jobs with an audit event", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        jobType: "agent.run",
        input: { objective: "Research AI agents" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().job.status).toBe("queued");
    expect(deps.database.appendAudit).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns HTTP 429 when a daily quota is exhausted", async () => {
    const deps = dependencies();
    const governance = new RuntimeGovernance({
      consumeQuota: vi.fn(async ({ limit }) => ({ allowed: false, used: limit, limit })),
      appendTrace: vi.fn(async () => undefined),
      listTraces: vi.fn(async () => []),
    }, { chat: 1, tool: 1, job: 1 });
    const app = await buildApp({ apiToken, ...deps, governance });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: "Quota exceeded",
      category: "chat",
      used: 1,
      limit: 1,
    });
    expect(deps.modelProvider.generate).not.toHaveBeenCalled();
    await app.close();
  });
});
