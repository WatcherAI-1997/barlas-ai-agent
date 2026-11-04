import { randomUUID } from "node:crypto";

import { evaluateAction } from "../policy/approval.js";
import type { RuntimeGovernance } from "../governance/runtime.js";
import type { AgentStore } from "../storage/types.js";
import { ToolRegistry } from "./registry.js";

export type ToolExecutionResult =
  | { status: "completed"; output: unknown; traceId?: string }
  | { status: "pending_approval"; approvalId: string; summary: string; traceId?: string }
  | { status: "indeterminate"; approvalId: string; summary: string; traceId?: string }
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
    if (!input.approved) {
      const approval = await this.store.decideApproval({
        id: input.approvalId,
        userId: input.userId,
        approved: false,
      });
      if (!approval) {
        const existing = await this.store.getApproval(input.userId, input.approvalId);
        if (!existing) throw new Error("Approval request was not found");
        if (existing.status === "rejected") {
          return { status: "rejected", approvalId: existing.id, ...(traceId ? { traceId } : {}) };
        }
        throw new Error("Approval request was already decided");
      }
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

    const executionToken = randomUUID();
    const claimed = await this.store.claimApprovalExecution({
      id: input.approvalId,
      userId: input.userId,
      executionToken,
    });
    if (!claimed) {
      const existing = await this.store.getApproval(input.userId, input.approvalId);
      if (!existing) throw new Error("Approval request was not found");
      if (existing.status === "executed") {
        return { status: "completed", output: existing.output ?? null, ...(traceId ? { traceId } : {}) };
      }
      if (existing.status === "rejected") {
        return { status: "rejected", approvalId: existing.id, ...(traceId ? { traceId } : {}) };
      }
      if (["approved", "executing", "failed"].includes(existing.status)) {
        return {
          status: "indeterminate",
          approvalId: existing.id,
          summary: existing.summary,
          ...(traceId ? { traceId } : {}),
        };
      }
      throw new Error("Approval request was already decided");
    }

    const approval = claimed;
    const tool = this.registry.get(approval.toolName);
    const parsedInput = tool.inputSchema.parse(approval.input);
    try {
      const output = await tool.execute(parsedInput, { userId: input.userId });
      const recorded = await this.store.completeApprovalExecution({
        id: approval.id,
        userId: input.userId,
        executionToken,
        succeeded: true,
        output,
      });
      if (!recorded) throw new Error("Tool completed but its execution fence was lost; reconciliation is required");
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
      await this.store.completeApprovalExecution({
        id: approval.id,
        userId: input.userId,
        executionToken,
        succeeded: false,
        error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error",
      });
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

  async reconcile(input: {
    approvalId: string;
    userId: string;
    resolution: "executed" | "rejected";
    output?: unknown;
    note: string;
  }): Promise<ToolExecutionResult> {
    const approval = await this.store.reconcileApprovalExecution({
      id: input.approvalId,
      userId: input.userId,
      resolution: input.resolution,
      output: input.output,
      note: input.note,
    });
    if (!approval) throw new Error("Indeterminate approval was not found or already reconciled");
    await this.store.appendAudit({
      userId: input.userId,
      eventType: `approval.reconciled.${input.resolution}`,
      resourceType: "tool",
      resourceId: approval.id,
      details: { toolName: approval.toolName, note: input.note },
    });
    return input.resolution === "executed"
      ? { status: "completed", output: approval.output ?? null }
      : { status: "rejected", approvalId: approval.id };
  }
}
