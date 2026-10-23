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
  nextReminderAt?: string;
  lastRemindedAt?: string;
  reminderIntervalHours?: number;
  reminderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentStore {
  createCommitment(input: {
    userId: string; title: string; details: string; dueAt?: Date; sourceConversationId?: string;
    reminderAt?: Date; reminderIntervalHours?: number;
  }): Promise<Commitment>;
  listCommitments(userId: string, statuses: CommitmentStatus[], limit: number): Promise<Commitment[]>;
  updateCommitment(input: {
    userId: string; id: string; status: CommitmentStatus; evidence?: string;
  }): Promise<Commitment | null>;
  configureCommitmentReminder(input: {
    userId: string; id: string; reminderAt?: Date; reminderIntervalHours?: number;
  }): Promise<Commitment | null>;
}

export interface CommitmentReminderStore {
  claimDueCommitmentReminders(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<Commitment[]>;
  completeCommitmentReminder(input: { id: string; userId: string; workerId: string }): Promise<boolean>;
  failCommitmentReminder(input: { id: string; userId: string; workerId: string; retryAt: Date }): Promise<boolean>;
}

export class ContinuityService {
  constructor(private readonly store: CommitmentStore) {}

  create(userId: string, input: { title: string; details?: string; dueAt?: string; sourceConversationId?: string; reminderAt?: string; reminderIntervalHours?: number }) {
    const dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
    const reminderAt = input.reminderAt ? new Date(input.reminderAt) : undefined;
    const reminderIntervalHours = reminderAt ? input.reminderIntervalHours ?? 24 : undefined;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error("Commitment due date is invalid");
    if (reminderAt && Number.isNaN(reminderAt.getTime())) throw new Error("Commitment reminder date is invalid");
    if (!reminderAt && input.reminderIntervalHours !== undefined) throw new Error("Commitment reminder interval requires a reminder date");
    if (reminderIntervalHours !== undefined && (!Number.isInteger(reminderIntervalHours) || reminderIntervalHours < 1 || reminderIntervalHours > 168)) {
      throw new Error("Commitment reminder interval must be between 1 and 168 hours");
    }
    return this.store.createCommitment({
      userId,
      title: input.title,
      details: input.details ?? "",
      ...(dueAt ? { dueAt } : {}),
      ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
      ...(reminderAt ? { reminderAt, reminderIntervalHours: reminderIntervalHours! } : {}),
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

  configureReminder(userId: string, id: string, input: { reminderAt?: string; reminderIntervalHours?: number }) {
    if (!input.reminderAt) return this.store.configureCommitmentReminder({ userId, id });
    const reminderAt = new Date(input.reminderAt);
    if (Number.isNaN(reminderAt.getTime())) throw new Error("Commitment reminder date is invalid");
    const interval = input.reminderIntervalHours ?? 24;
    if (!Number.isInteger(interval) || interval < 1 || interval > 168) throw new Error("Commitment reminder interval must be between 1 and 168 hours");
    return this.store.configureCommitmentReminder({ userId, id, reminderAt, reminderIntervalHours: interval });
  }

  async context(userId: string): Promise<string | null> {
    const commitments = await this.list(userId, ["open", "in_progress", "waiting"], 25);
    if (!commitments.length) return null;
    const now = Date.now();
    return [
      "Unfinished Barlas commitments. Do not claim they are complete without recorded evidence:",
      ...commitments.map((item) => {
        const overdueMs = item.dueAt ? now - Date.parse(item.dueAt) : -1;
        const urgency = overdueMs >= 7 * 86_400_000 ? "; OVERDUE; ESCALATED" : overdueMs >= 0 ? "; OVERDUE" : "";
        const due = item.dueAt ? `; due ${item.dueAt}${urgency}` : "";
        return `- ${item.id} [${item.status}${due}]: ${item.title}${item.details ? ` — ${item.details}` : ""}`;
      }),
    ].join("\n").slice(0, 20_000);
  }
}
