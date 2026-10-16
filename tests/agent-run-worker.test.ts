import { describe, expect, it, vi } from "vitest";

import type { AgentRunRecord, AgentRunStore } from "../src/runs/types.js";
import { AgentRunWorker } from "../src/runs/worker.js";

const run: AgentRunRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "user-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  status: "running",
  messages: [{ role: "user", content: "Do it" }],
  conversationMessages: [{ role: "user", content: "Do it" }],
  taskClass: "fast",
  maxSteps: 8,
  scheduledFor: "2026-10-16T00:00:00.000Z",
  attempts: 1,
  maxAttempts: 3,
  workerId: "worker-test",
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
};

describe("Barlas AI Agent asynchronous run worker", () => {
  it("claims and completes queued autonomous work", async () => {
    const appendAgentRunEvent = vi.fn(async () => undefined);
    const store = {
      claimAgentRuns: vi.fn(async () => [run]),
      appendAgentRunEvent,
      failClaimedAgentRun: vi.fn(),
    } as unknown as AgentRunStore;
    const finished = { ...run, status: "completed" as const };
    const runtime = { executeClaimed: vi.fn(async () => finished) };
    const onFinished = vi.fn(async () => undefined);
    const worker = new AgentRunWorker(store, runtime, { workerId: "worker-test", onFinished });

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(runtime.executeClaimed).toHaveBeenCalledWith(run);
    expect(onFinished).toHaveBeenCalledWith(finished);
    expect(appendAgentRunEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "run.started" }));
  });

  it("schedules a bounded retry after a transient failure", async () => {
    const failClaimedAgentRun = vi.fn(async () => "queued" as const);
    const store = {
      claimAgentRuns: vi.fn(async () => [run]),
      appendAgentRunEvent: vi.fn(async () => undefined),
      failClaimedAgentRun,
    } as unknown as AgentRunStore;
    const runtime = { executeClaimed: vi.fn(async () => { throw new Error("temporary"); }) };
    const worker = new AgentRunWorker(store, runtime, { workerId: "worker-test", retryBaseMs: 1 });

    await worker.runOnce();

    expect(failClaimedAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      id: run.id,
      workerId: "worker-test",
      error: "temporary",
      retryAt: expect.any(Date),
    }));
  });
});
