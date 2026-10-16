import type { AgentLoopContinuation, AgentLoopResult } from "../core/agent-loop.js";
import type { AgentMessage, ModelToolOutput } from "../core/models.js";

export type AgentRunStatus = AgentLoopResult["status"] | "queued" | "running" | "failed";

export interface AgentRunRecord {
  id: string;
  userId: string;
  conversationId: string;
  status: AgentRunStatus;
  messages: AgentMessage[];
  conversationMessages: AgentMessage[];
  delivery?: { channel: "telegram"; chatId: number; voice?: boolean };
  taskClass: "fast" | "deep" | "private";
  allowedTools?: string[];
  maxSteps: number;
  maxTotalTokens?: number;
  continuation?: AgentLoopContinuation;
  pendingApprovalId?: string;
  result?: AgentLoopResult;
  error?: string;
  scheduledFor: string;
  attempts: number;
  maxAttempts: number;
  workerId?: string;
  createdAt: string;
  updatedAt: string;
  scheduleId?: string;
  scheduleOccurrence?: string;
}

export interface AgentRunEvent {
  id: number;
  runId: string;
  step: number;
  eventType: string;
  details: unknown;
  createdAt: string;
}

export interface AgentRunStore {
  createAgentRun(input: {
    userId: string;
    conversationId: string;
    messages: AgentMessage[];
    conversationMessages?: AgentMessage[];
    taskClass: "fast" | "deep" | "private";
    allowedTools?: string[];
    maxSteps: number;
    maxTotalTokens?: number;
  }): Promise<AgentRunRecord>;
  enqueueAgentRun(input: {
    userId: string;
    conversationId: string;
    messages: AgentMessage[];
    conversationMessages: AgentMessage[];
    delivery?: { channel: "telegram"; chatId: number; voice?: boolean };
    taskClass: "fast" | "deep" | "private";
    allowedTools?: string[];
    maxSteps: number;
    maxTotalTokens?: number;
    scheduledFor?: Date;
    scheduleId?: string;
    scheduleOccurrence?: Date;
  }): Promise<AgentRunRecord>;
  getAgentRun(userId: string, id: string): Promise<AgentRunRecord | null>;
  findAgentRunByApproval(userId: string, approvalId: string): Promise<AgentRunRecord | null>;
  listAgentRuns(userId: string, limit: number): Promise<AgentRunRecord[]>;
  updateAgentRun(input: {
    id: string;
    userId: string;
    status: AgentRunStatus;
    continuation?: AgentLoopContinuation;
    pendingApprovalId?: string;
    result?: AgentLoopResult;
    error?: string;
    workerId?: string;
  }): Promise<AgentRunRecord | null>;
  cancelAgentRun(userId: string, id: string): Promise<AgentRunRecord | null>;
  appendAgentRunEvent(input: { runId: string; step: number; eventType: string; details?: unknown }): Promise<void>;
  listAgentRunEvents(userId: string, runId: string): Promise<AgentRunEvent[]>;
  getApprovalOutcome(userId: string, approvalId: string): Promise<{
    status: "pending" | "approved" | "rejected" | "executed" | "failed";
    output?: unknown;
  } | null>;
  listReadyAgentRuns(limit: number): Promise<AgentRunRecord[]>;
  claimAgentRuns(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<AgentRunRecord[]>;
  failClaimedAgentRun(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: Date;
  }): Promise<"queued" | "failed" | null>;
}

export interface ResumeAgentRunInput {
  run: AgentRunRecord;
  toolOutputs: ModelToolOutput[];
}
