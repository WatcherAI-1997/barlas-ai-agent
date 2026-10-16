import { describe, expect, it, vi } from "vitest";

import { QuotaExceededError, RuntimeGovernance, type GovernanceStore } from "../src/governance/runtime.js";

function store(allowed: boolean): GovernanceStore {
  return {
    consumeQuota: vi.fn(async ({ limit }) => ({ allowed, used: allowed ? 1 : limit, limit })),
    appendTrace: vi.fn(async () => undefined),
    listTraces: vi.fn(async () => []),
  };
}

describe("Barlas AI Agent runtime governance", () => {
  it("consumes a category-specific daily quota", async () => {
    const database = store(true);
    const governance = new RuntimeGovernance(database, { chat: 5, tool: 10, job: 2 });

    await expect(governance.consume("user-1", "chat")).resolves.toEqual({
      allowed: true,
      used: 1,
      limit: 5,
    });
    expect(database.consumeQuota).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      category: "chat",
      limit: 5,
    }));
  });

  it("raises a structured error when quota is exhausted", async () => {
    const governance = new RuntimeGovernance(store(false), { chat: 5, tool: 10, job: 2 });
    await expect(governance.consume("user-1", "job")).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
