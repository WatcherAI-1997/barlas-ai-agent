import { randomUUID } from "node:crypto";

import type { AgentRunRecord } from "../runs/types.js";
import type { RuntimeGovernance } from "../governance/runtime.js";
import { nextOccurrence } from "./service.js";
import type { AgentSchedule, ScheduleStore } from "./types.js";

export class ScheduleWorker {
  readonly workerId: string;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;

  constructor(
    private readonly store: ScheduleStore,
    private readonly runtime: { enqueue(input: {
      userId: string; conversationId: string; messages: AgentRunRecord["messages"];
      conversationMessages: AgentRunRecord["conversationMessages"]; delivery?: AgentRunRecord["delivery"];
      taskClass: AgentRunRecord["taskClass"]; allowedTools?: string[]; maxSteps: number;
      maxTotalTokens?: number; scheduleId?: string; scheduleOccurrence?: Date;
    }): Promise<unknown> },
    private readonly options: {
      pollIntervalMs?: number; batchSize?: number; leaseSeconds?: number;
      telegramChatForUser?: (userId: string) => Promise<number | null>;
      governance?: RuntimeGovernance;
      contextForSchedule?: (schedule: AgentSchedule) => Promise<AgentRunRecord["messages"]>;
      onError?: (error: unknown) => void;
    } = {},
  ) { this.workerId = `barlas-scheduler-${randomUUID()}`; }

  start(): void { if (!this.timer && !this.running) { this.stopping = false; void this.tick(); } }
  async stop(): Promise<void> { this.stopping = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; while (this.running) await new Promise((resolve) => setTimeout(resolve, 10)); }

  async runOnce(): Promise<number> {
    const schedules = await this.store.claimDueSchedules({ workerId: this.workerId, limit: this.options.batchSize ?? 4, leaseSeconds: this.options.leaseSeconds ?? 300 });
    for (const schedule of schedules) await this.dispatch(schedule);
    return schedules.length;
  }

  private async dispatch(schedule: AgentSchedule): Promise<void> {
    const occurrence = new Date(schedule.nextRunAt);
    try {
      await this.options.governance?.consume(schedule.userId, "job");
      const chatId = schedule.deliveryChannel === "telegram" ? await this.options.telegramChatForUser?.(schedule.userId) : null;
      if (schedule.deliveryChannel === "telegram" && !chatId) throw new Error("Telegram account is not linked");
      const context = await this.options.contextForSchedule?.(schedule) ?? [];
      await this.runtime.enqueue({
        userId: schedule.userId,
        conversationId: randomUUID(),
        messages: [...context, { role: "user", content: schedule.objective }],
        conversationMessages: [{ role: "user", content: schedule.objective }],
        taskClass: schedule.taskClass,
        maxSteps: schedule.maxSteps,
        maxTotalTokens: schedule.maxTotalTokens,
        ...(schedule.allowedTools ? { allowedTools: schedule.allowedTools } : {}),
        ...(chatId ? { delivery: { channel: "telegram" as const, chatId } } : {}),
        scheduleId: schedule.id,
        scheduleOccurrence: occurrence,
      });
      const nextRunAt = nextOccurrence(
        schedule.cronExpression,
        schedule.timezone,
        new Date(Math.max(occurrence.getTime(), Date.now())),
      );
      if (!await this.store.advanceSchedule({ id: schedule.id, workerId: this.workerId, occurrence, nextRunAt })) throw new Error("Lost schedule lease");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown schedule error";
      await this.store.failSchedule({ id: schedule.id, workerId: this.workerId, error: message.slice(0, 1_000), retryAt: new Date(Date.now() + 60_000) });
      this.options.onError?.(error);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    try { await this.runOnce(); } catch (error) { this.options.onError?.(error); }
    finally { this.running = false; if (!this.stopping) { this.timer = setTimeout(() => void this.tick(), this.options.pollIntervalMs ?? 1_000); this.timer.unref(); } }
  }
}
