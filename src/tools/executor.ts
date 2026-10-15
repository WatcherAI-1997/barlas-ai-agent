import { evaluateAction } from "../policy/approval.js";
import type { AgentStore } from "../storage/types.js";
import { ToolRegistry } from "./registry.js";

export type ToolExecutionResult =
  | { status: "completed"; output: unknown }
  | { status: "pending_approval"; approvalId: string; summary: string }
  | { status: "rejected"; approvalId: string };

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly store: AgentStore,
  ) {}

  listTools() {
    return this.registry.list();
  }

  async execute(input: {
    userId: string;
    toolName: string;
    toolInput: unknown;
    summary: string;
  }): Promise<ToolExecutionResult> {
    const tool = this.registry.get(input.toolName);
    const parsedInput = tool.inputSchema.parse(input.toolInput);
    const decision = evaluateAction({ tool: tool.name, risk: tool.risk, summary: input.summary });

    if (decision.requiresApproval) {
      if (tool.risk === "read") throw new Error("Read-only tools cannot require approval");
      const approval = await this.store.createApproval({
        userId: input.userId,
        toolName: tool.name,
        risk: tool.risk,
        summary: input.summary,
        toolInput: parsedInput,
      });
      await this.store.appendAudit({
        userId: input.userId,
        eventType: "approval.requested",
        resourceType: "tool",
        resourceId: approval.id,
        details: { toolName: tool.name, risk: tool.risk },
      });
      return {
        status: "pending_approval",
        approvalId: approval.id,
        summary: approval.summary,
      };
    }

    const output = await tool.execute(parsedInput, { userId: input.userId });
    await this.store.appendAudit({
      userId: input.userId,
      eventType: "tool.executed",
      resourceType: "tool",
      resourceId: tool.name,
      details: { risk: tool.risk },
    });
    return { status: "completed", output };
  }

  async decide(input: {
    approvalId: string;
    userId: string;
    approved: boolean;
  }): Promise<ToolExecutionResult> {
    const approval = await this.store.decideApproval({
      id: input.approvalId,
      userId: input.userId,
      approved: input.approved,
    });
    if (!approval) throw new Error("Approval request was not found or already decided");

    if (!input.approved) {
      await this.store.appendAudit({
        userId: input.userId,
        eventType: "approval.rejected",
        resourceType: "tool",
        resourceId: approval.id,
        details: { toolName: approval.toolName },
      });
      return { status: "rejected", approvalId: approval.id };
    }

    const tool = this.registry.get(approval.toolName);
    const parsedInput = tool.inputSchema.parse(approval.input);
    try {
      const output = await tool.execute(parsedInput, { userId: input.userId });
      await this.store.markApprovalExecuted(approval.id, true);
      await this.store.appendAudit({
        userId: input.userId,
        eventType: "approval.executed",
        resourceType: "tool",
        resourceId: approval.id,
        details: { toolName: approval.toolName, risk: approval.risk },
      });
      return { status: "completed", output };
    } catch (error) {
      await this.store.markApprovalExecuted(approval.id, false);
      throw error;
    }
  }
}

