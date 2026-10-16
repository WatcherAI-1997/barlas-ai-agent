import { describe, expect, it, vi } from "vitest";

import { nextOccurrence, ScheduleService } from "../src/schedules/service.js";
import type { AgentSchedule, ScheduleStore } from "../src/schedules/types.js";
import { ScheduleWorker } from "../src/schedules/worker.js";

function record(overrides: Partial<AgentSchedule> = {}): AgentSchedule {
  return {
    id: "00000000-0000-4000-8000-000000000111", userId: "user-1", name: "Morning brief",
    objective: "Prepare brief", cronExpression: "0 9 * * *", timezone: "Asia/Tashkent",
    taskClass: "deep", maxSteps: 8, maxTotalTokens: 20_000, deliveryChannel: "web",
    status: "active", nextRunAt: "2026-10-17T04:00:00.000Z", createdAt: "2026-10-16T00:00:00.000Z",
    ...overrides,
  };
}

function store(initial = record()) {
  let item = initial;
  const value: ScheduleStore = {
    createSchedule: vi.fn(async (input) => (item = record({ ...input, nextRunAt: input.nextRunAt.toISOString() }))),
    listSchedules: vi.fn(async () => [item]),
    setScheduleStatus: vi.fn(async (_userId, _id, status, next) => (item = { ...item, status, ...(next ? { nextRunAt: next.toISOString() } : {}) })),
    claimDueSchedules: vi.fn(async () => [item]),
    advanceSchedule: vi.fn(async () => true),
    failSchedule: vi.fn(async () => true),
  };
  return value;
}

describe("recurring autonomous schedules", () => {
  it("calculates timezone-aware cron occurrences and rejects invalid zones", () => {
    expect(nextOccurrence("0 9 * * *", "Asia/Tashkent", new Date("2026-10-16T05:00:00Z")).toISOString())
      .toBe("2026-10-17T04:00:00.000Z");
    expect(() => nextOccurrence("0 9 * * *", "Mars/Olympus", new Date())).toThrow(/timezone/i);
  });

  it("creates, pauses, and resumes a schedule with a recomputed next run", async () => {
    const schedules = store();
    const service = new ScheduleService(schedules);
    await service.create({ userId: "user-1", name: "Brief", objective: "Prepare", cronExpression: "0 9 * * *", timezone: "Asia/Tashkent", taskClass: "deep", maxSteps: 8, maxTotalTokens: 20_000, deliveryChannel: "web" });
    expect(schedules.createSchedule).toHaveBeenCalled();
    expect((await service.pause("user-1", record().id))?.status).toBe("paused");
    expect((await service.resume("user-1", record().id))?.status).toBe("active");
  });

  it("dispatches an idempotency-keyed autonomous run and advances the schedule", async () => {
    const schedules = store();
    const runtime = { enqueue: vi.fn(async () => ({ id: "run-1" })) };
    const worker = new ScheduleWorker(schedules, runtime, { telegramChatForUser: async () => null });
    expect(await worker.runOnce()).toBe(1);
    expect(runtime.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", scheduleId: record().id, scheduleOccurrence: new Date(record().nextRunAt),
      messages: [{ role: "user", content: "Prepare brief" }],
    }));
    expect(schedules.advanceSchedule).toHaveBeenCalledOnce();
  });

  it("does not dispatch Telegram delivery when the account is unlinked", async () => {
    const schedules = store(record({ deliveryChannel: "telegram" }));
    const runtime = { enqueue: vi.fn() };
    await new ScheduleWorker(schedules, runtime, { telegramChatForUser: async () => null }).runOnce();
    expect(runtime.enqueue).not.toHaveBeenCalled();
    expect(schedules.failSchedule).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/not linked/i) }));
  });
});
