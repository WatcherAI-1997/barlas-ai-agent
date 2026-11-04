import { describe, expect, it, vi } from "vitest";

import { Database } from "../src/storage/database.js";

describe("agent run lease persistence", () => {
  it("renews only a live lease owned by the same worker", async () => {
    const query = vi.fn(async (_sql: string, _parameters: unknown[]) => ({ rowCount: 1 }));
    const database = Object.create(Database.prototype) as Database;
    Object.defineProperty(database, "pool", { value: { query } });

    await expect(database.renewAgentRunLease({
      id: "00000000-0000-4000-8000-000000000010",
      workerId: "worker-a",
      leaseSeconds: 300,
    })).resolves.toBe(true);

    const [sql, parameters] = query.mock.calls[0]!;
    expect(String(sql)).toContain("worker_id = $2");
    expect(String(sql)).toContain("status = 'running'");
    expect(String(sql)).toContain("locked_at > now() - make_interval(secs => $3)");
    expect(parameters).toEqual(["00000000-0000-4000-8000-000000000010", "worker-a", 300]);
  });

  it("refuses renewal when the compare-and-set predicate no longer owns a row", async () => {
    const database = Object.create(Database.prototype) as Database;
    Object.defineProperty(database, "pool", {
      value: { query: vi.fn(async (_sql: string, _parameters: unknown[]) => ({ rowCount: 0 })) },
    });

    await expect(database.renewAgentRunLease({
      id: "00000000-0000-4000-8000-000000000010",
      workerId: "worker-old",
      leaseSeconds: 300,
    })).resolves.toBe(false);
  });

  it("checkpoints continuation only for the current running owner", async () => {
    const query = vi.fn(async (_sql: string, _parameters: unknown[]) => ({ rowCount: 1 }));
    const database = Object.create(Database.prototype) as Database;
    Object.defineProperty(database, "pool", { value: { query } });
    const continuation = {
      previousResponseId: "anthropic:opaque",
      steps: 2,
      toolExecutions: 1,
      approvalIds: [],
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15, costUsd: 0 },
      last: { text: "", provider: "anthropic", model: "claude-test" },
      completedToolOutputs: [{ callId: "tool-1", output: '{"ok":true}' }],
    };

    await expect(database.checkpointAgentRun({
      id: "00000000-0000-4000-8000-000000000010",
      userId: "user-1",
      workerId: "worker-a",
      continuation,
    })).resolves.toBe(true);

    const [sql, parameters] = query.mock.calls[0]!;
    expect(String(sql)).toContain("status = 'running'");
    expect(String(sql)).toContain("worker_id = $4");
    expect(parameters).toEqual([
      "00000000-0000-4000-8000-000000000010",
      "user-1",
      JSON.stringify(continuation),
      "worker-a",
    ]);
  });
});
