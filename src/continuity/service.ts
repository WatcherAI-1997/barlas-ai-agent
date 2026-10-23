export const commitmentStatuses = ["open", "in_progress", "waiting", "completed", "cancelled"] as const;
export type CommitmentStatus = (typeof commitmentStatuses)[number];

export interface Commitment {
  id: string;
  userId: string;
  title: string;
  details: string;
  status: CommitmentStatus;
  dueAt?: string;
  evidence?: string;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentStore {
  createCommitment(input: {
    userId: string; title: string; details: string; dueAt?: Date; sourceConversationId?: string;
  }): Promise<Commitment>;
  listCommitments(userId: string, statuses: CommitmentStatus[], limit: number): Promise<Commitment[]>;
  updateCommitment(input: {
    userId: string; id: string; status: CommitmentStatus; evidence?: string;
  }): Promise<Commitment | null>;
}

export class ContinuityService {
  constructor(private readonly store: CommitmentStore) {}

  create(userId: string, input: { title: string; details?: string; dueAt?: string; sourceConversationId?: string }) {
    const dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error("Commitment due date is invalid");
    return this.store.createCommitment({
      userId,
      title: input.title,
      details: input.details ?? "",
      ...(dueAt ? { dueAt } : {}),
      ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
    });
  }

  list(userId: string, statuses: CommitmentStatus[] = ["open", "in_progress", "waiting"], limit = 50) {
    return this.store.listCommitments(userId, statuses, limit);
  }

  update(userId: string, id: string, status: CommitmentStatus, evidence?: string) {
    const normalizedEvidence = evidence?.trim();
    if (status === "completed" && !normalizedEvidence) {
      throw new Error("Completion requires verifiable evidence or a concrete result");
    }
    return this.store.updateCommitment({
      userId, id, status,
      ...(normalizedEvidence ? { evidence: normalizedEvidence } : {}),
    });
  }

  async context(userId: string): Promise<string | null> {
    const commitments = await this.list(userId, ["open", "in_progress", "waiting"], 25);
    if (!commitments.length) return null;
    const now = Date.now();
    return [
      "Unfinished Barlas commitments. Do not claim they are complete without recorded evidence:",
      ...commitments.map((item) => {
        const due = item.dueAt ? `; due ${item.dueAt}${Date.parse(item.dueAt) < now ? "; OVERDUE" : ""}` : "";
        return `- ${item.id} [${item.status}${due}]: ${item.title}${item.details ? ` — ${item.details}` : ""}`;
      }),
    ].join("\n").slice(0, 20_000);
  }
}
