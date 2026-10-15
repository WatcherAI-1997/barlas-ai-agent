import type { AgentMessage, GenerateResult } from "../core/models.js";

export interface MemoryEntry {
  id: string;
  userId: string;
  content: string;
  category: string;
  importance: number;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  toolName: string;
  risk: "write" | "external" | "destructive";
  summary: string;
  input: unknown;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  createdAt: string;
}

export interface DurableJob {
  id: string;
  userId: string;
  jobType: string;
  input: unknown;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  scheduledFor: string;
  attempts: number;
  maxAttempts: number;
  result?: unknown;
  error?: string;
  createdAt: string;
}

export interface AgentStore {
  ping(): Promise<void>;
  saveTurn(input: {
    conversationId: string;
    userId: string;
    messages: AgentMessage[];
    result: GenerateResult;
  }): Promise<void>;
  remember(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
  }): Promise<MemoryEntry>;
  recall(userId: string, query: string, limit: number): Promise<MemoryEntry[]>;
  createApproval(input: {
    userId: string;
    toolName: string;
    risk: "write" | "external" | "destructive";
    summary: string;
    toolInput: unknown;
  }): Promise<ApprovalRequest>;
  decideApproval(input: {
    id: string;
    userId: string;
    approved: boolean;
  }): Promise<ApprovalRequest | null>;
  markApprovalExecuted(id: string, succeeded: boolean): Promise<void>;
  appendAudit(input: {
    userId: string;
    eventType: string;
    resourceType: string;
    resourceId?: string;
    details?: unknown;
  }): Promise<void>;
  createJob(input: {
    userId: string;
    jobType: string;
    jobInput: unknown;
    scheduledFor: Date;
  }): Promise<DurableJob>;
  listJobs(userId: string, limit: number): Promise<DurableJob[]>;
  claimJobs(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<DurableJob[]>;
  completeJob(input: { id: string; workerId: string; result: unknown }): Promise<boolean>;
  failJob(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: Date;
  }): Promise<"queued" | "failed" | null>;
  close(): Promise<void>;
}
