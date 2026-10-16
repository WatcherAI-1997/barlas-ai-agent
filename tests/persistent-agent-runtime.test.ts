import { describe, expect, it, vi } from "vitest";

import type { AgentLoopResult } from "../src/core/agent-loop.js";
import { PersistentAgentRuntime } from "../src/runs/runtime.js";
import type { AgentRunRecord, AgentRunStore } from "../src/runs/types.js";

const runId = "00000000-0000-4000-8000-000000000010";
const approvalId = "00000000-0000-4000-8000-000000000011";

function result(status: AgentLoopResult["status"]): AgentLoopResult {
  const value: AgentLoopResult = {
    status,
    text: status === "completed" ? "Finished" : "Waiting",
    steps: 1,
    toolExecutions: 1,
    approvalIds: status === "waiting_approval" ? [approvalId] : [],
    result: { text: status === "completed" ? "Finished" : "Waiting", provider: "test", model: "test" },
  };
  if (status === "waiting_approval") {
    value.continuation = {
      previousResponseId: "response-1",
      pendingCallId: "call-1",
      steps: 1,
      toolExecutions: 1,
      approvalIds: [approvalId],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 },
      last: { text: "", provider: "test", model: "test", responseId: "response-1" },
    };
  }
  return value;
}

function memoryStore() {
  let current: AgentRunRecord | null = null;
  const events: string[] = [];
  const store: AgentRunStore = {
    createAgentRun: vi.fn(async (input): Promise<AgentRunRecord> => {
      const created: AgentRunRecord = {
        id: runId,
        ...input,
        status: "running",
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      };
      current = created;
      return created;
    }),
    getAgentRun: vi.fn(async (userId, id) => current && current.userId === userId && current.id === id ? current : null),
    findAgentRunByApproval: vi.fn(async (userId, id) => current && current.userId === userId && current.pendingApprovalId === id ? current : null),
    listAgentRuns: vi.fn(async () => current ? [current] : []),
    updateAgentRun: vi.fn(async (input) => {
      if (!current || current.id !== input.id || current.status === "cancelled") return null;
      current = {
        ...current,
        status: input.status,
        ...(input.continuation ? { continuation: input.continuation } : {}),
        ...(input.pendingApprovalId ? { pendingApprovalId: input.pendingApprovalId } : {}),
        ...(input.result ? { result: input.result } : {}),
        ...(input.error ? { error: input.error } : {}),
      };
      return current;
    }),
    cancelAgentRun: vi.fn(async () => current ? (current = { ...current, status: "cancelled" }) : null),
    appendAgentRunEvent: vi.fn(async ({ eventType }) => { events.push(eventType); }),
    listAgentRunEvents: vi.fn(async () => []),
    getApprovalOutcome: vi.fn(async () => ({ status: "executed" as const, output: { written: true } })),
    listReadyAgentRuns: vi.fn(async () => current ? [current] : []),
  };
  return { store, events, current: () => current };
}

describe("Barlas AI Agent persistent runtime", () => {
  it("persists a completed autonomous run", async () => {
    const memory = memoryStore();
    const loop = { run: vi.fn(async (input: { onStep?: (event: { step: number; type: string }) => Promise<void> }) => {
      await input.onStep?.({ step: 1, type: "model.completed" });
      return result("completed");
    }) };
    const runtime = new PersistentAgentRuntime(loop, memory.store);

    const run = await runtime.start({
      userId: "user-1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "user", content: "Do it" }],
      taskClass: "fast",
      maxSteps: 8,
    });

    expect(run.status).toBe("completed");
    expect(memory.events).toEqual(["model.completed"]);
  });

  it("resumes the exact waiting run with the approved tool output", async () => {
    const memory = memoryStore();
    const loop = { run: vi.fn()
      .mockResolvedValueOnce(result("waiting_approval"))
      .mockResolvedValueOnce(result("completed")) };
    const runtime = new PersistentAgentRuntime(loop, memory.store);
    await runtime.start({
      userId: "user-1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "user", content: "Write it" }],
      taskClass: "fast",
      maxSteps: 8,
    });

    const resumed = await runtime.resumeByApproval({
      userId: "user-1",
      approvalId,
      output: { written: true },
    });

    expect(resumed?.status).toBe("completed");
    expect(loop.run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      continuation: expect.objectContaining({ pendingCallId: "call-1" }),
      toolOutputs: [{ callId: "call-1", output: '{"written":true}' }],
    }));
  });
});
