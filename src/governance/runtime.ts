import { randomUUID } from "node:crypto";

export type QuotaCategory = "chat" | "tool" | "job";
export type TraceStatus = "started" | "completed" | "pending" | "rejected" | "failed";

export interface TraceEvent {
  traceId: string;
  userId: string;
  operation: string;
  status: TraceStatus;
  details: unknown;
  createdAt: string;
}

export interface GovernanceStore {
  consumeQuota(input: {
    userId: string;
    category: QuotaCategory;
    periodStart: string;
    limit: number;
  }): Promise<{ allowed: boolean; used: number; limit: number }>;
  appendTrace(input: {
    traceId: string;
    userId: string;
    operation: string;
    status: TraceStatus;
    details?: unknown;
  }): Promise<void>;
  listTraces(userId: string, limit: number): Promise<TraceEvent[]>;
}

export class QuotaExceededError extends Error {
  constructor(
    readonly category: QuotaCategory,
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Daily ${category} quota exceeded (${used}/${limit})`);
    this.name = "QuotaExceededError";
  }
}

export class RuntimeGovernance {
  constructor(
    private readonly store: GovernanceStore,
    private readonly limits: Record<QuotaCategory, number>,
  ) {}

  newTraceId(): string {
    return randomUUID();
  }

  async consume(userId: string, category: QuotaCategory) {
    const usage = await this.store.consumeQuota({
      userId,
      category,
      periodStart: new Date().toISOString().slice(0, 10),
      limit: this.limits[category],
    });
    if (!usage.allowed) throw new QuotaExceededError(category, usage.used, usage.limit);
    return usage;
  }

  async trace(input: {
    traceId: string;
    userId: string;
    operation: string;
    status: TraceStatus;
    details?: unknown;
  }): Promise<void> {
    await this.store.appendTrace(input);
  }

  list(userId: string, limit: number): Promise<TraceEvent[]> {
    return this.store.listTraces(userId, limit);
  }
}
