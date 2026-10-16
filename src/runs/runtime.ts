import type { AgentLoop, AgentLoopResult } from "../core/agent-loop.js";
import type { ModelToolOutput } from "../core/models.js";
import type { AgentRunRecord, AgentRunStore } from "./types.js";

export class PersistentAgentRuntime {
  constructor(
    private readonly loop: Pick<AgentLoop, "run">,
    private readonly store: AgentRunStore,
  ) {}

  async start(input: {
    userId: string;
    conversationId: string;
    messages: AgentRunRecord["messages"];
    conversationMessages?: AgentRunRecord["conversationMessages"];
    taskClass: AgentRunRecord["taskClass"];
    maxSteps: number;
    maxTotalTokens?: number;
    allowedTools?: string[];
  }): Promise<AgentRunRecord> {
    const run = await this.store.createAgentRun(input);
    return this.execute(run);
  }

  async enqueue(input: {
    userId: string;
    conversationId: string;
    messages: AgentRunRecord["messages"];
    conversationMessages: AgentRunRecord["conversationMessages"];
    delivery?: AgentRunRecord["delivery"];
    taskClass: AgentRunRecord["taskClass"];
    maxSteps: number;
    maxTotalTokens?: number;
    allowedTools?: string[];
    scheduledFor?: Date;
  }): Promise<AgentRunRecord> {
    const run = await this.store.enqueueAgentRun({
      userId: input.userId,
      conversationId: input.conversationId,
      messages: input.messages,
      conversationMessages: input.conversationMessages,
      taskClass: input.taskClass,
      maxSteps: input.maxSteps,
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
      ...(input.maxTotalTokens ? { maxTotalTokens: input.maxTotalTokens } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    });
    await this.store.appendAgentRunEvent({ runId: run.id, step: 0, eventType: "run.queued" });
    return run;
  }

  executeClaimed(run: AgentRunRecord): Promise<AgentRunRecord> {
    if (run.status !== "running" || !run.workerId) throw new Error("Agent run is not leased by a worker");
    return this.execute(run);
  }

  async resumeByApproval(input: {
    userId: string;
    approvalId: string;
    output: unknown;
    rejected?: boolean;
  }): Promise<AgentRunRecord | null> {
    const run = await this.store.findAgentRunByApproval(input.userId, input.approvalId);
    if (!run || run.status !== "waiting_approval" || !run.continuation?.pendingCallId) return run;
    const value = input.rejected ? { rejected: true } : input.output;
    const toolOutputs: ModelToolOutput[] = [...(run.continuation.completedToolOutputs ?? []), {
      callId: run.continuation.pendingCallId,
      output: (JSON.stringify(value) ?? "null").slice(0, 40_000),
    }];
    const claimed = await this.store.updateAgentRun({ id: run.id, userId: run.userId, status: "running" });
    if (!claimed) return null;
    const { pendingApprovalId: _pendingApprovalId, ...resumable } = run;
    return this.execute({ ...resumable, status: "running" }, toolOutputs);
  }

  async resume(userId: string, runId: string): Promise<AgentRunRecord | null> {
    const run = await this.store.getAgentRun(userId, runId);
    if (!run || run.status !== "waiting_approval" || !run.pendingApprovalId) return run;
    const approval = await this.store.getApprovalOutcome(userId, run.pendingApprovalId);
    if (!approval || !["executed", "rejected"].includes(approval.status)) return run;
    return this.resumeByApproval({
      userId,
      approvalId: run.pendingApprovalId,
      output: approval.output ?? null,
      rejected: approval.status === "rejected",
    });
  }

  async recoverReady(limit = 20): Promise<AgentRunRecord[]> {
    const ready = await this.store.listReadyAgentRuns(limit);
    const recovered: AgentRunRecord[] = [];
    for (const run of ready) {
      const result = await this.resume(run.userId, run.id);
      if (result) recovered.push(result);
    }
    return recovered;
  }

  async get(userId: string, id: string) {
    return this.store.getAgentRun(userId, id);
  }

  async list(userId: string, limit: number) {
    return this.store.listAgentRuns(userId, limit);
  }

  async events(userId: string, id: string) {
    return this.store.listAgentRunEvents(userId, id);
  }

  async cancel(userId: string, id: string) {
    return this.store.cancelAgentRun(userId, id);
  }

  private async execute(run: AgentRunRecord, toolOutputs?: ModelToolOutput[]): Promise<AgentRunRecord> {
    try {
      const result = await this.loop.run({
        userId: run.userId,
        conversationId: run.conversationId,
        messages: run.messages,
        taskClass: run.taskClass,
        maxSteps: run.maxSteps,
        ...(run.maxTotalTokens ? { maxTotalTokens: run.maxTotalTokens } : {}),
        ...(run.allowedTools ? { allowedTools: run.allowedTools } : {}),
        ...(run.continuation ? { continuation: run.continuation } : {}),
        ...(toolOutputs ? { toolOutputs } : {}),
        shouldCancel: async () => (await this.store.getAgentRun(run.userId, run.id))?.status === "cancelled",
        onStep: async (event) => this.store.appendAgentRunEvent({
          runId: run.id,
          step: event.step,
          eventType: event.type,
          details: event.details,
        }),
      });
      return await this.persistResult(run, result);
    } catch (error) {
      if (run.workerId) throw error;
      const failed = await this.store.updateAgentRun({
        id: run.id,
        userId: run.userId,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error",
      });
      if (!failed) throw error;
      return failed;
    }
  }

  private async persistResult(run: AgentRunRecord, result: AgentLoopResult): Promise<AgentRunRecord> {
    const pendingApprovalId = result.approvalIds.at(-1);
    const updated = await this.store.updateAgentRun({
      id: run.id,
      userId: run.userId,
      status: result.status,
      ...(result.continuation ? { continuation: result.continuation } : {}),
      ...(pendingApprovalId ? { pendingApprovalId } : {}),
      result,
      ...(run.workerId ? { workerId: run.workerId } : {}),
    });
    if (!updated) throw new Error("Agent run was cancelled or changed concurrently");
    return updated;
  }
}
