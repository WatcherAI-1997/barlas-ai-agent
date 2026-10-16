import type { AgentLoopContinuation, AgentLoopResult } from "../core/agent-loop.js";
import type { AgentMessage, ModelToolOutput } from "../core/models.js";

export type AgentRunStatus = AgentLoopResult["status"] | "running" | "failed";

export interface AgentRunRecord {
  id: string;
  userId: string;
  conversationId: string;
  status: AgentRunStatus;
  messages: AgentMessage[];
  taskClass: "fast" | "deep" | "private";
  allowedTools?: string[];
  maxSteps: number;
  maxTotalTokens?: number;
  continuation?: AgentLoopContinuation;
  pendingApprovalId?: string;
  result?: AgentLoopResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
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
    taskClass: "fast" | "deep" | "private";
    allowedTools?: string[];
    maxSteps: number;
    maxTotalTokens?: number;
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
  }): Promise<AgentRunRecord | null>;
  cancelAgentRun(userId: string, id: string): Promise<AgentRunRecord | null>;
  appendAgentRunEvent(input: { runId: string; step: number; eventType: string; details?: unknown }): Promise<void>;
  listAgentRunEvents(userId: string, runId: string): Promise<AgentRunEvent[]>;
  getApprovalOutcome(userId: string, approvalId: string): Promise<{
    status: "pending" | "approved" | "rejected" | "executed" | "failed";
    output?: unknown;
  } | null>;
  listReadyAgentRuns(limit: number): Promise<AgentRunRecord[]>;
}

export interface ResumeAgentRunInput {
  run: AgentRunRecord;
  toolOutputs: ModelToolOutput[];
}
