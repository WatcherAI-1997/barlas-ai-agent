import { describe, expect, it, vi } from "vitest";

import type { AgentStore, ApprovalRequest } from "../src/storage/types.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";
import { ToolExecutor } from "../src/tools/executor.js";
import type { ProjectService } from "../src/projects/service.js";

const projectId = "00000000-0000-4000-8000-000000000201";

function approvalStore(): AgentStore {
  let pending: ApprovalRequest | null = null;
  return {
    createApproval: vi.fn(async (input) => {
      pending = {
        id: "00000000-0000-4000-8000-000000000299",
        userId: input.userId,
        toolName: input.toolName,
        risk: input.risk,
        summary: input.summary,
        input: input.toolInput,
        status: "pending",
        createdAt: "2026-10-16T00:00:00.000Z",
      };
      return pending;
    }),
    decideApproval: vi.fn(async ({ id, userId, approved }) => {
      const request = pending;
      if (!request || request.id !== id || request.userId !== userId) return null;
      return { ...request, status: approved ? "approved" : "rejected" };
    }),
    markApprovalExecuted: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
  } as unknown as AgentStore;
}

describe("approval-gated project tools", () => {
  it("reads only the authenticated user's project immediately", async () => {
    const detail = vi.fn(async (userId: string, id: string) => ({ project: { userId, id } }));
    const projectService = {
      detail,
      createGoal: async () => null, updateGoal: async () => null, createStep: async () => null,
      updateStep: async () => null, checkpoint: async () => null, snapshot: async () => ({ id: "x" }), restore: async () => null,
    } as unknown as Pick<ProjectService, "detail" | "createGoal" | "updateGoal" | "createStep" | "updateStep" | "checkpoint" | "snapshot" | "restore">;
    const registry = createBuiltinToolRegistry({ projectService });
    const executor = new ToolExecutor(registry, approvalStore());
    await expect(executor.execute({ userId: "user-1", toolName: "projects.get", toolInput: { projectId }, summary: "Read project" }))
      .resolves.toEqual({ status: "completed", output: { project: { userId: "user-1", id: projectId } } });
    expect(detail).toHaveBeenCalledWith("user-1", projectId);
  });

  it("does not mutate a project before approval and executes the stored exact input afterward", async () => {
    const createGoal = vi.fn(async (userId: string, id: string, title: string, description: string, priority: number) => ({ userId, id, title, description, priority }));
    const projectService = {
      detail: async () => null,
      createGoal,
      updateGoal: async () => null, createStep: async () => null, updateStep: async () => null,
      checkpoint: async () => null, snapshot: async () => ({ id: "x" }), restore: async () => null,
    } as unknown as Pick<ProjectService, "detail" | "createGoal" | "updateGoal" | "createStep" | "updateStep" | "checkpoint" | "snapshot" | "restore">;
    const registry = createBuiltinToolRegistry({ projectService });
    const executor = new ToolExecutor(registry, approvalStore());
    const requested = await executor.execute({
      userId: "user-1",
      toolName: "projects.goal.create",
      toolInput: { projectId, title: "Ship", description: "Closed alpha", priority: 10 },
      summary: "Create project goal Ship",
    });
    expect(requested).toEqual(expect.objectContaining({ status: "pending_approval" }));
    expect(createGoal).not.toHaveBeenCalled();

    const completed = await executor.decide({
      approvalId: "00000000-0000-4000-8000-000000000299",
      userId: "user-1",
      approved: true,
    });
    expect(completed).toEqual(expect.objectContaining({ status: "completed" }));
    expect(createGoal).toHaveBeenCalledWith("user-1", projectId, "Ship", "Closed alpha", 10);
  });
});
