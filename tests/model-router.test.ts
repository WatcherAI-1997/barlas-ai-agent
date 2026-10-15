import { describe, expect, it, vi } from "vitest";

import { ModelRouter } from "../src/core/model-router.js";
import type { ModelProvider } from "../src/core/models.js";

function provider(name: string, text = name): ModelProvider {
  return {
    name,
    generate: vi.fn(async () => ({ text, provider: name, model: `${name}-model` })),
  };
}

const request = {
  userId: "user-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe("Barlas AI Agent model router", () => {
  it("routes private tasks only to the private provider", async () => {
    const fast = provider("fast");
    const deep = provider("deep");
    const privateProvider = provider("private");
    const router = new ModelRouter({ fast, deep, private: privateProvider });

    const result = await router.generate({ ...request, taskClass: "private" });
    expect(result.provider).toBe("private");
    expect(privateProvider.generate).toHaveBeenCalledOnce();
    expect(fast.generate).not.toHaveBeenCalled();
    expect(deep.generate).not.toHaveBeenCalled();
  });

  it("falls back from fast to deep", async () => {
    const fast: ModelProvider = {
      name: "fast",
      generate: vi.fn(async () => {
        throw new Error("temporary failure");
      }),
    };
    const deep = provider("deep");
    const router = new ModelRouter({ fast, deep, private: provider("private") });

    const result = await router.generate({ ...request, taskClass: "fast" });
    expect(result.provider).toBe("deep");
  });
});
