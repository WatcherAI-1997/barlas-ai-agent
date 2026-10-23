import { describe, expect, it, vi } from "vitest";

import type { Commitment, CommitmentReminderStore } from "../src/continuity/service.js";
import { commitmentReminderText, ContinuityReminderWorker } from "../src/continuity/worker.js";

function reminder(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "00000000-0000-4000-8000-000000000001", userId: "owner", title: "Deliver release",
    details: "Retain verification output.", status: "in_progress", dueAt: "2026-10-01T00:00:00.000Z",
    nextReminderAt: "2026-10-08T00:00:00.000Z", reminderIntervalHours: 24, reminderCount: 3,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z", ...overrides,
  };
}

class ReminderStore implements CommitmentReminderStore {
  records = [reminder()];
  completed: string[] = [];
  failed: string[] = [];

  async claimDueCommitmentReminders() { return this.records.splice(0); }
  async completeCommitmentReminder(input: { id: string }) { this.completed.push(input.id); return true; }
  async failCommitmentReminder(input: { id: string }) { this.failed.push(input.id); return true; }
}

describe("continuity reminder worker", () => {
  it("delivers a leased reminder and acknowledges it only after delivery", async () => {
    const store = new ReminderStore();
    const deliver = vi.fn(async () => undefined);
    const worker = new ContinuityReminderWorker(store, deliver);

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner" }), expect.stringContaining("Escalated overdue"));
    expect(store.completed).toEqual([reminder().id]);
    expect(store.failed).toEqual([]);
  });

  it("releases failed deliveries for bounded retry without acknowledging them", async () => {
    const store = new ReminderStore();
    const onError = vi.fn();
    const worker = new ContinuityReminderWorker(store, async () => { throw new Error("offline"); }, { onError });

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(store.completed).toEqual([]);
    expect(store.failed).toEqual([reminder().id]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("renders ordinary and escalated reminder levels deterministically", () => {
    expect(commitmentReminderText(reminder({ dueAt: "2026-11-01T00:00:00.000Z", reminderCount: 0 }), new Date("2026-10-24T00:00:00.000Z"))).toContain("Barlas commitment reminder");
    expect(commitmentReminderText(reminder(), new Date("2026-10-24T00:00:00.000Z"))).toContain("Escalated overdue");
  });
});
