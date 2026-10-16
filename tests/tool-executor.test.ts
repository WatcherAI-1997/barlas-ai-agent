import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import type { AgentStore, ApprovalRequest } from "../src/storage/types.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { ToolRegistry } from "../src/tools/registry.js";

function store(): AgentStore {
  const approval: ApprovalRequest = {
    id: "00000000-0000-4000-8000-000000000004",
    userId: "user-1",
    toolName: "external.notify",
    risk: "external",
    summary: "Send notification",
    input: { message: "Hello" },
    status: "pending",
    createdAt: "2026-10-16T00:00:00.000Z",
  };

  return {
    ping: vi.fn(async () => undefined),
    saveTurn: vi.fn(async () => undefined),
    remember: vi.fn(async () => {
      throw new Error("not used");
    }),
    recall: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    createApproval: vi.fn(async () => approval),
    decideApproval: vi.fn(async ({ approved }): Promise<ApprovalRequest | null> => ({
      ...approval,
      status: approved ? "approved" : "rejected",
    })),
    markApprovalExecuted: vi.fn(async () => undefined),
    listApprovals: vi.fn(async () => []),
    appendAudit: vi.fn(async () => undefined),
    createJob: vi.fn(async () => {
      throw new Error("not used");
    }),
    listJobs: vi.fn(async () => []),
    cancelJob: vi.fn(async () => null),
    retryJob: vi.fn(async () => null),
    getDashboardStats: vi.fn(async () => ({ conversations: 0, messages: 0, queuedJobs: 0, failedJobs: 0, pendingApprovals: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 })),
    claimJobs: vi.fn(async () => []),
    completeJob: vi.fn(async () => true),
    failJob: vi.fn(async () => "failed" as const),
    close: vi.fn(async () => undefined),
  };
}

describe("Barlas AI Agent tool executor", () => {
  it("executes read-only tools immediately", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "read.echo",
      description: "Echo",
      risk: "read",
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => input,
    });
    const executor = new ToolExecutor(registry, store());

    await expect(executor.execute({
      userId: "user-1",
      toolName: "read.echo",
      toolInput: { value: "hello" },
      summary: "Echo text",
    })).resolves.toEqual({ status: "completed", output: { value: "hello" } });
  });

  it("queues external actions for approval before execution", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ sent: true }));
    registry.register({
      name: "external.notify",
      description: "Notify",
      risk: "external",
      inputSchema: z.object({ message: z.string() }),
      execute,
    });
    const executor = new ToolExecutor(registry, store());

    const pending = await executor.execute({
      userId: "user-1",
      toolName: "external.notify",
      toolInput: { message: "Hello" },
      summary: "Send notification",
    });
    expect(pending.status).toBe("pending_approval");
    expect(execute).not.toHaveBeenCalled();

    const completed = await executor.decide({
      approvalId: "00000000-0000-4000-8000-000000000004",
      userId: "user-1",
      approved: true,
    });
    expect(completed).toEqual({ status: "completed", output: { sent: true } });
    expect(execute).toHaveBeenCalledOnce();
  });
});
