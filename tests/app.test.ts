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
    expect(deps.database.saveTurn).toHaveBeenCalledOnce();
    await app.close();
  });
});

