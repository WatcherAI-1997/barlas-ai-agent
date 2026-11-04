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
        conversationMessages: input.conversationMessages ?? input.messages,
        status: "running",
        scheduledFor: "2026-10-16T00:00:00.000Z",
        attempts: 0,
        maxAttempts: 3,
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      };
      current = created;
      return created;
    }),
    enqueueAgentRun: vi.fn(async (input) => {
      const queued: AgentRunRecord = {
        id: runId,
        ...input,
        status: "queued",
        scheduledFor: (input.scheduledFor ?? new Date("2026-10-16T00:00:00.000Z")).toISOString(),
        attempts: 0,
        maxAttempts: 3,
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      };
      current = queued;
      return queued;
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
    checkpointAgentRun: vi.fn(async (input) => {
      if (!current || current.id !== input.id || current.userId !== input.userId || current.status !== "running") return false;
      if (input.workerId && current.workerId !== input.workerId) return false;
      current = { ...current, continuation: input.continuation };
      return true;
    }),
    cancelAgentRun: vi.fn(async () => current ? (current = { ...current, status: "cancelled" }) : null),
    appendAgentRunEvent: vi.fn(async ({ eventType }) => { events.push(eventType); }),
    listAgentRunEvents: vi.fn(async () => []),
    getApprovalOutcome: vi.fn(async () => ({ status: "executed" as const, output: { written: true } })),
    listReadyAgentRuns: vi.fn(async () => current ? [current] : []),
    claimAgentRuns: vi.fn(async () => []),
    renewAgentRunLease: vi.fn(async () => true),
    failClaimedAgentRun: vi.fn(async () => "failed" as const),
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

  it("does not persist a stale result after worker lease ownership is lost", async () => {
    const memory = memoryStore();
    const loop = { run: vi.fn(async () => result("completed")) };
    const runtime = new PersistentAgentRuntime(loop, memory.store);
    const leased: AgentRunRecord = {
      id: runId,
      userId: "user-1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "running",
      messages: [{ role: "user", content: "Do it" }],
      conversationMessages: [{ role: "user", content: "Do it" }],
      taskClass: "deep",
      maxSteps: 8,
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 1,
      maxAttempts: 3,
      workerId: "worker-old",
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    };

    await expect(runtime.executeClaimed(leased, () => true)).rejects.toThrow(/lease ownership was lost/i);
    expect(memory.store.updateAgentRun).not.toHaveBeenCalled();
  });

  it("persists a provider checkpoint and resumes a failed run from it", async () => {
    const memory = memoryStore();
    const checkpoint = {
      previousResponseId: "response-before-outage",
      steps: 1,
      toolExecutions: 1,
      approvalIds: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 },
      last: { text: "", provider: "test", model: "test-model", responseId: "response-before-outage" },
      completedToolOutputs: [{ callId: "call-1", output: '{"ok":true}' }],
    };
    const loop = { run: vi.fn()
      .mockImplementationOnce(async (input: { onCheckpoint?: (value: typeof checkpoint) => Promise<void> }) => {
        await input.onCheckpoint?.(checkpoint);
        throw new Error("provider unavailable");
      })
      .mockResolvedValueOnce(result("completed")) };
    const runtime = new PersistentAgentRuntime(loop, memory.store);
    const failed = await runtime.start({
      userId: "user-1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      messages: [{ role: "user", content: "Continue after the tool" }],
      taskClass: "fast",
      maxSteps: 8,
    });

    expect(failed.status).toBe("failed");
    expect(failed.continuation).toEqual(checkpoint);
    const resumed = await runtime.resume("user-1", runId);
    expect(resumed?.status).toBe("completed");
    expect(loop.run).toHaveBeenNthCalledWith(2, expect.objectContaining({ continuation: checkpoint }));
    expect(memory.events).toContain("run.checkpointed");
  });
});
