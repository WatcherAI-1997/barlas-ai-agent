import { describe, expect, it, vi } from "vitest";

import { JobWorker } from "../src/jobs/worker.js";
import type { AgentStore, DurableJob } from "../src/storage/types.js";

const job: DurableJob = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "user-1",
  jobType: "agent.run",
  input: { objective: "Summarize the plan" },
  status: "running",
  scheduledFor: "2026-10-16T00:00:00.000Z",
  attempts: 1,
  maxAttempts: 3,
  createdAt: "2026-10-16T00:00:00.000Z",
};

function store(claimed: DurableJob[] = [job]): AgentStore {
  return {
    ping: vi.fn(async () => undefined),
    saveTurn: vi.fn(async () => undefined),
    remember: vi.fn(async () => { throw new Error("not used"); }),
    recall: vi.fn(async () => []),
    createApproval: vi.fn(async () => { throw new Error("not used"); }),
    decideApproval: vi.fn(async () => null),
    markApprovalExecuted: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
    createJob: vi.fn(async () => { throw new Error("not used"); }),
    listJobs: vi.fn(async () => []),
    claimJobs: vi.fn(async () => claimed),
    completeJob: vi.fn(async () => true),
    failJob: vi.fn(async () => "queued" as const),
    close: vi.fn(async () => undefined),
  };
}

describe("Barlas AI Agent durable worker", () => {
  it("claims and completes a registered job", async () => {
    const database = store();
    const worker = new JobWorker(database, { workerId: "worker-test" });
    worker.register("agent.run", async () => ({ text: "done" }));

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(database.completeJob).toHaveBeenCalledWith({
      id: job.id,
      workerId: "worker-test",
      result: { text: "done" },
    });
    expect(database.failJob).not.toHaveBeenCalled();
  });

  it("reschedules a failed job with bounded retries", async () => {
    const database = store();
    const worker = new JobWorker(database, { workerId: "worker-test", retryBaseMs: 1 });
    worker.register("agent.run", async () => { throw new Error("temporary"); });

    await worker.runOnce();
    expect(database.failJob).toHaveBeenCalledWith(expect.objectContaining({
      id: job.id,
      workerId: "worker-test",
      error: "temporary",
      retryAt: expect.any(Date),
    }));
  });

  it("fails unknown job types without retrying forever", async () => {
    const unknown = { ...job, jobType: "unknown" };
    const database = store([unknown]);
    const worker = new JobWorker(database, { workerId: "worker-test" });

    await worker.runOnce();
    expect(database.failJob).toHaveBeenCalledWith({
      id: unknown.id,
      workerId: "worker-test",
      error: "No handler registered for job type: unknown",
    });
  });
});
