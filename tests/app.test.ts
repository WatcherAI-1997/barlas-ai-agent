import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ModelProvider } from "../src/core/models.js";

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
});
