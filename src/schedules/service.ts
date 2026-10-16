import { Cron } from "croner";

import type { AgentSchedule, ScheduleStore } from "./types.js";

export class ScheduleService {
  constructor(private readonly store: ScheduleStore) {}

  async create(input: {
    userId: string; name: string; objective: string; cronExpression: string; timezone: string;
    taskClass: AgentSchedule["taskClass"]; allowedTools?: string[]; maxSteps: number;
    maxTotalTokens: number; deliveryChannel: AgentSchedule["deliveryChannel"];
  }): Promise<AgentSchedule> {
    const nextRunAt = nextOccurrence(input.cronExpression, input.timezone, new Date());
    return this.store.createSchedule({ ...input, nextRunAt });
  }

  list(userId: string, limit: number) { return this.store.listSchedules(userId, limit); }

  async pause(userId: string, id: string) { return this.store.setScheduleStatus(userId, id, "paused"); }

  async resume(userId: string, id: string): Promise<AgentSchedule | null> {
    const schedules = await this.store.listSchedules(userId, 100);
    const schedule = schedules.find((item) => item.id === id);
    if (!schedule || schedule.status === "disabled") return null;
    const nextRunAt = nextOccurrence(schedule.cronExpression, schedule.timezone, new Date());
    return this.store.setScheduleStatus(userId, id, "active", nextRunAt);
  }

  disable(userId: string, id: string) { return this.store.setScheduleStatus(userId, id, "disabled"); }
}

export function nextOccurrence(expression: string, timezone: string, after: Date): Date {
  if (expression.length > 100) throw new Error("Cron expression is too long");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(after); } catch { throw new Error("Invalid IANA timezone"); }
  const cron = new Cron(expression, { timezone, paused: true, mode: "5-part" });
  const next = cron.nextRun(after);
  if (!next) throw new Error("Cron expression has no future occurrence");
  const following = cron.nextRun(next);
  if (following && following.getTime() - next.getTime() < 60_000) throw new Error("Schedules may run at most once per minute");
  return next;
}
