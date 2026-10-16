import { describe, expect, it, vi } from "vitest";

import { AgentLoop, type AgentLoopTools } from "../src/core/agent-loop.js";
import type { GenerateToolRequest, ToolCapableModelProvider } from "../src/core/models.js";

const request = {
  userId: "user-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  messages: [{ role: "user" as const, content: "What time is it?" }],
};

function provider(
  steps: Array<{ text?: string; calls?: Array<{ callId: string; name: string; arguments: unknown }> }>,
  totalTokens = 15,
) {
  let index = 0;
  const model: ToolCapableModelProvider = {
    name: "test",
    generate: vi.fn(async () => ({ text: "plain", provider: "test", model: "test-model" })),
    generateWithTools: vi.fn(async (_input: GenerateToolRequest) => {
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      return {
        text: step.text ?? "",
        provider: "test",
        model: "test-model",
        responseId: `response-${index}`,
        toolCalls: step.calls ?? [],
        usage: { inputTokens: totalTokens - 5, outputTokens: 5, totalTokens, costUsd: 0.01 },
      };
    }),
  };
  return model;
}

function tools(execute: AgentLoopTools["execute"]): AgentLoopTools {
  return {
    listModelTools: vi.fn(() => [{
      modelName: "system_time",
      toolName: "system.time",
      description: "Current time",
      parameters: { type: "object", properties: {} },
    }]),
    execute,
  };
}

describe("Barlas AI Agent autonomous loop", () => {
  it("feeds tool output back to the model and returns the final answer", async () => {
    const model = provider([
      { calls: [{ callId: "call-1", name: "system_time", arguments: {} }] },
      { text: "It is noon." },
    ]);
    const execute = vi.fn(async () => ({ status: "completed" as const, output: { iso: "2026-10-16T12:00:00Z" } }));
    const loop = new AgentLoop(model, tools(execute));

    const result = await loop.run(request);

    expect(result.status).toBe("completed");
    expect(result.text).toBe("It is noon.");
    expect(result.steps).toBe(2);
    expect(result.toolExecutions).toBe(1);
    expect(result.result.usage?.totalTokens).toBe(30);
    expect(model.generateWithTools).toHaveBeenNthCalledWith(2, expect.objectContaining({
      previousResponseId: "response-1",
      toolOutputs: [{ callId: "call-1", output: '{"iso":"2026-10-16T12:00:00Z"}' }],
    }));
  });

  it("pauses before executing a risky action", async () => {
    const model = provider([{ calls: [{ callId: "call-1", name: "system_time", arguments: {} }] }]);
    const execute = vi.fn(async () => ({
      status: "pending_approval" as const,
      approvalId: "00000000-0000-4000-8000-000000000009",
      summary: "Needs approval",
    }));
    const result = await new AgentLoop(model, tools(execute)).run(request);

    expect(result.status).toBe("waiting_approval");
    expect(result.approvalIds).toEqual(["00000000-0000-4000-8000-000000000009"]);
    expect(result.continuation).toMatchObject({
      previousResponseId: "response-1",
      pendingCallId: "call-1",
      steps: 1,
    });
    expect(model.generateWithTools).toHaveBeenCalledOnce();
  });

  it("continues from a persisted approval checkpoint", async () => {
    const model = provider([{ text: "Write completed." }]);
    const execute = vi.fn();
    const loop = new AgentLoop(model, tools(execute));
    const continuation = {
      previousResponseId: "response-before-restart",
      pendingCallId: "call-write",
      steps: 1,
      toolExecutions: 1,
      approvalIds: ["00000000-0000-4000-8000-000000000009"],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
      last: { text: "", provider: "test", model: "test-model", responseId: "response-before-restart" },
    };

    const result = await loop.run({
      ...request,
      continuation,
      toolOutputs: [{ callId: "call-write", output: '{"written":true}' }],
    });

    expect(result.status).toBe("completed");
    expect(result.steps).toBe(2);
    expect(model.generateWithTools).toHaveBeenCalledWith(expect.objectContaining({
      previousResponseId: "response-before-restart",
      toolOutputs: [{ callId: "call-write", output: '{"written":true}' }],
    }));
  });

  it("stops at the configured step limit", async () => {
    const model = provider([{ calls: [{ callId: "call-1", name: "system_time", arguments: {} }] }]);
    const execute = vi.fn(async () => ({ status: "completed" as const, output: { ok: true } }));
    const result = await new AgentLoop(model, tools(execute), 2).run(request);

    expect(result.status).toBe("step_limit");
    expect(result.steps).toBe(2);
    expect(result.toolExecutions).toBe(2);
  });

  it("stops before tool execution when the token budget is exhausted", async () => {
    const model = provider(
      [{ calls: [{ callId: "call-1", name: "system_time", arguments: {} }] }],
      1_000,
    );
    const execute = vi.fn(async () => ({ status: "completed" as const, output: { ok: true } }));
    const result = await new AgentLoop(model, tools(execute), 8, 1_000).run(request);

    expect(result.status).toBe("budget_limit");
    expect(result.toolExecutions).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("honors cancellation that arrives while the model is responding", async () => {
    const model = provider([{ calls: [{ callId: "call-1", name: "system_time", arguments: {} }] }]);
    const execute = vi.fn(async () => ({ status: "completed" as const, output: { ok: true } }));
    const shouldCancel = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await new AgentLoop(model, tools(execute)).run({ ...request, shouldCancel });

    expect(result.status).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects tool names that are not in the registry mapping", async () => {
    const model = provider([{ calls: [{ callId: "call-1", name: "shell", arguments: {} }] }]);
    const execute = vi.fn();

    await expect(new AgentLoop(model, tools(execute)).run(request))
      .rejects.toThrow("unavailable tool");
    expect(execute).not.toHaveBeenCalled();
  });
});
