import { evaluateAction } from "../policy/approval.js";
import type { RuntimeGovernance } from "../governance/runtime.js";
import type { AgentStore } from "../storage/types.js";
import { ToolRegistry } from "./registry.js";

export type ToolExecutionResult =
  | { status: "completed"; output: unknown; traceId?: string }
  | { status: "pending_approval"; approvalId: string; summary: string; traceId?: string }
  | { status: "rejected"; approvalId: string; traceId?: string };

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly store: AgentStore,
    private readonly governance?: RuntimeGovernance,
  ) {}

  listTools() {
    return this.registry.list();
  }

  listModelTools(allowedTools?: string[]) {
    return this.registry.listForModel(allowedTools);
  }

  async execute(input: {
    userId: string;
    toolName: string;
    toolInput: unknown;
    summary: string;
  }): Promise<ToolExecutionResult> {
    await this.governance?.consume(input.userId, "tool");
    const traceId = this.governance?.newTraceId();
    if (traceId) {
      await this.governance?.trace({
        traceId,
        userId: input.userId,
        operation: `tool:${input.toolName}`,
        status: "started",
      });
    }
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
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `tool:${tool.name}`,
          status: "pending",
          details: { approvalId: approval.id, risk: tool.risk },
        });
      }
      return {
        status: "pending_approval",
        approvalId: approval.id,
        summary: approval.summary,
        ...(traceId ? { traceId } : {}),
      };
    }

    try {
      const output = await tool.execute(parsedInput, { userId: input.userId });
      await this.store.appendAudit({
        userId: input.userId,
        eventType: "tool.executed",
        resourceType: "tool",
        resourceId: tool.name,
        details: { risk: tool.risk },
      });
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `tool:${tool.name}`,
          status: "completed",
        });
      }
      return { status: "completed", output, ...(traceId ? { traceId } : {}) };
    } catch (error) {
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `tool:${tool.name}`,
          status: "failed",
          details: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
        });
      }
      throw error;
    }
  }

  async decide(input: {
    approvalId: string;
    userId: string;
    approved: boolean;
  }): Promise<ToolExecutionResult> {
    await this.governance?.consume(input.userId, "tool");
    const traceId = this.governance?.newTraceId();
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
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `approval:${approval.toolName}`,
          status: "rejected",
          details: { approvalId: approval.id },
        });
      }
      return { status: "rejected", approvalId: approval.id, ...(traceId ? { traceId } : {}) };
    }

    const tool = this.registry.get(approval.toolName);
    const parsedInput = tool.inputSchema.parse(approval.input);
    try {
      const output = await tool.execute(parsedInput, { userId: input.userId });
      await this.store.markApprovalExecuted(approval.id, true, output);
      await this.store.appendAudit({
        userId: input.userId,
        eventType: "approval.executed",
        resourceType: "tool",
        resourceId: approval.id,
        details: { toolName: approval.toolName, risk: approval.risk },
      });
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `approval:${approval.toolName}`,
          status: "completed",
          details: { approvalId: approval.id },
        });
      }
      return { status: "completed", output, ...(traceId ? { traceId } : {}) };
    } catch (error) {
      await this.store.markApprovalExecuted(approval.id, false);
      if (traceId) {
        await this.governance?.trace({
          traceId,
          userId: input.userId,
          operation: `approval:${approval.toolName}`,
          status: "failed",
          details: {
            approvalId: approval.id,
            error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
          },
        });
      }
      throw error;
    }
  }
}
