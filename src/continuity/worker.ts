import { randomUUID } from "node:crypto";

import type { Commitment, CommitmentReminderStore } from "./service.js";

export function commitmentReminderText(commitment: Commitment, now = new Date()): string {
  const dueAt = commitment.dueAt ? new Date(commitment.dueAt) : null;
  const overdueDays = dueAt ? Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000)) : 0;
  const heading = overdueDays >= 7 ? "Escalated overdue Barlas commitment" : overdueDays > 0 || (dueAt && dueAt <= now) ? "Overdue Barlas commitment" : "Barlas commitment reminder";
  return [
    heading,
    commitment.title,
    ...(commitment.details ? [commitment.details] : []),
    ...(commitment.dueAt ? [`Due: ${commitment.dueAt}`] : []),
    `Reminder #${commitment.reminderCount + 1}`,
  ].join("\n");
}

export class ContinuityReminderWorker {
  readonly workerId = `barlas-continuity-${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;

  constructor(
    private readonly store: CommitmentReminderStore,
    private readonly deliver: (commitment: Commitment, text: string) => Promise<void>,
    private readonly options: { pollIntervalMs?: number; batchSize?: number; leaseSeconds?: number; retryMs?: number; isPaused?: () => Promise<boolean>; onError?: (error: unknown) => void } = {},
  ) {}

  start(): void { if (!this.timer && !this.running) { this.stopping = false; void this.tick(); } }
  async stop(): Promise<void> { this.stopping = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; while (this.running) await new Promise((resolve) => setTimeout(resolve, 10)); }

  async runOnce(): Promise<number> {
    if (await this.options.isPaused?.()) return 0;
    const reminders = await this.store.claimDueCommitmentReminders({ workerId: this.workerId, limit: this.options.batchSize ?? 10, leaseSeconds: this.options.leaseSeconds ?? 300 });
    for (const commitment of reminders) {
      try {
        await this.deliver(commitment, commitmentReminderText(commitment));
        if (!await this.store.completeCommitmentReminder({ id: commitment.id, userId: commitment.userId, workerId: this.workerId })) throw new Error("Lost commitment reminder lease");
      } catch (error) {
        await this.store.failCommitmentReminder({ id: commitment.id, userId: commitment.userId, workerId: this.workerId, retryAt: new Date(Date.now() + (this.options.retryMs ?? 900_000)) });
        this.options.onError?.(error);
      }
    }
    return reminders.length;
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    try { await this.runOnce(); } catch (error) { this.options.onError?.(error); }
    finally { this.running = false; if (!this.stopping) { this.timer = setTimeout(() => void this.tick(), this.options.pollIntervalMs ?? 30_000); this.timer.unref(); } }
  }
}
