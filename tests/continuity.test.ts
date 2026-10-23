import { describe, expect, it } from "vitest";

import { ContinuityService, type Commitment, type CommitmentStatus, type CommitmentStore } from "../src/continuity/service.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

class MemoryCommitments implements CommitmentStore {
  records: Commitment[] = [];

  async createCommitment(input: { userId: string; title: string; details: string; dueAt?: Date; sourceConversationId?: string; reminderAt?: Date; reminderIntervalHours?: number }) {
    const now = new Date().toISOString();
    const record: Commitment = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: input.userId, title: input.title, details: input.details, status: "open",
      ...(input.dueAt ? { dueAt: input.dueAt.toISOString() } : {}),
      ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
      ...(input.reminderAt ? { nextReminderAt: input.reminderAt.toISOString(), reminderIntervalHours: input.reminderIntervalHours ?? 24 } : {}),
      reminderCount: 0, createdAt: now, updatedAt: now,
    };
    this.records.push(record);
    return record;
  }

  async listCommitments(userId: string, statuses: CommitmentStatus[], limit: number) {
    return this.records.filter((record) => record.userId === userId && statuses.includes(record.status)).slice(0, limit);
  }

  async updateCommitment(input: { userId: string; id: string; status: CommitmentStatus; evidence?: string }) {
    const record = this.records.find((item) => item.userId === input.userId && item.id === input.id);
    if (!record) return null;
    record.status = input.status;
    if (input.evidence) record.evidence = input.evidence;
    record.updatedAt = new Date().toISOString();
    return record;
  }

  async configureCommitmentReminder(input: { userId: string; id: string; reminderAt?: Date; reminderIntervalHours?: number }) {
    const record = this.records.find((item) => item.userId === input.userId && item.id === input.id && !["completed", "cancelled"].includes(item.status));
    if (!record) return null;
    if (input.reminderAt) {
      record.nextReminderAt = input.reminderAt.toISOString();
      if (input.reminderIntervalHours) record.reminderIntervalHours = input.reminderIntervalHours;
    } else {
      delete record.nextReminderAt;
      delete record.reminderIntervalHours;
    }
    return record;
  }
}

describe("Barlas Continuity", () => {
  it("persists promises and surfaces overdue unfinished work", async () => {
    const store = new MemoryCommitments();
    const service = new ContinuityService(store);
    const commitment = await service.create("owner", {
      title: "Deliver the verified release",
      details: "Run the release gate and retain its output.",
      dueAt: "2020-01-01T00:00:00.000Z",
      sourceConversationId: "00000000-0000-4000-8000-000000000099",
    });

    expect(commitment.status).toBe("open");
    await expect(service.context("owner")).resolves.toContain("OVERDUE");
    await expect(service.context("another-owner")).resolves.toBeNull();
  });

  it("refuses unverifiable completion but accepts concrete evidence", async () => {
    const store = new MemoryCommitments();
    const service = new ContinuityService(store);
    const commitment = await service.create("owner", { title: "Ship the feature" });

    expect(() => service.update("owner", commitment.id, "completed")).toThrow(/evidence/i);
    const completed = await service.update("owner", commitment.id, "completed", "Tests 214/214 passed; commit abc1234.");
    expect(completed).toMatchObject({ status: "completed", evidence: "Tests 214/214 passed; commit abc1234." });
    await expect(service.context("owner")).resolves.toBeNull();
  });

  it("keeps mutations approval-gated while exposing inspection as read-only", () => {
    const registry = createBuiltinToolRegistry({ continuity: new ContinuityService(new MemoryCommitments()) });
    expect(registry.get("continuity.commitments.list").risk).toBe("read");
    expect(registry.get("continuity.commitments.create").risk).toBe("write");
    expect(registry.get("continuity.commitments.update").risk).toBe("write");
    expect(registry.get("continuity.commitments.reminder.configure").risk).toBe("write");
  });

  it("configures bounded repeating reminders only for unfinished owned commitments", async () => {
    const store = new MemoryCommitments();
    const service = new ContinuityService(store);
    const commitment = await service.create("owner", { title: "Follow up" });

    await expect(service.configureReminder("another-owner", commitment.id, { reminderAt: "2026-10-25T00:00:00.000Z" })).resolves.toBeNull();
    expect(() => service.configureReminder("owner", commitment.id, { reminderAt: "2026-10-25T00:00:00.000Z", reminderIntervalHours: 0 })).toThrow(/between 1 and 168/i);
    await expect(service.configureReminder("owner", commitment.id, { reminderAt: "2026-10-25T00:00:00.000Z", reminderIntervalHours: 24 })).resolves.toMatchObject({ reminderIntervalHours: 24 });
    await expect(service.configureReminder("owner", commitment.id, {})).resolves.not.toHaveProperty("nextReminderAt");
  });

  it("defaults an explicitly requested first reminder to a daily interval", async () => {
    const service = new ContinuityService(new MemoryCommitments());
    await expect(service.create("owner", { title: "Follow up", reminderAt: "2026-10-25T00:00:00.000Z" })).resolves.toMatchObject({ reminderIntervalHours: 24 });
    expect(() => service.create("owner", { title: "Invalid", reminderIntervalHours: 24 })).toThrow(/requires a reminder date/i);
  });
});
