import { randomUUID } from "node:crypto";

import type { AgentStore, DurableJob } from "../storage/types.js";

export type JobHandler = (job: DurableJob) => Promise<unknown>;

export interface JobWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  batchSize?: number;
  retryBaseMs?: number;
  onError?: (error: unknown) => void;
}

export class JobWorker {
  readonly workerId: string;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;
  private readonly batchSize: number;
  private readonly retryBaseMs: number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;

  constructor(
    private readonly store: AgentStore,
    options: JobWorkerOptions = {},
  ) {
    this.workerId = options.workerId ?? `barlas-worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.leaseSeconds = options.leaseSeconds ?? 300;
    this.batchSize = options.batchSize ?? 4;
    this.retryBaseMs = options.retryBaseMs ?? 2_000;
    this.onError = options.onError ?? (() => undefined);
  }

  private readonly onError: (error: unknown) => void;

  register(jobType: string, handler: JobHandler): void {
    if (this.handlers.has(jobType)) throw new Error(`Job handler ${jobType} is already registered`);
    this.handlers.set(jobType, handler);
  }

  start(): void {
    if (this.timer || this.running) return;
    this.stopping = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async runOnce(): Promise<number> {
    const jobs = await this.store.claimJobs({
      workerId: this.workerId,
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
    });
    await Promise.all(jobs.map((job) => this.process(job)));
    return jobs.length;
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
      if (!this.stopping) {
        this.timer = setTimeout(() => void this.tick(), this.pollIntervalMs);
        this.timer.unref();
      }
    }
  }

  private async process(job: DurableJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    try {
      if (!handler) throw new Error(`No handler registered for job type: ${job.jobType}`);
      const result = await handler(job);
      const completed = await this.store.completeJob({
        id: job.id,
        workerId: this.workerId,
        result,
      });
      if (!completed) throw new Error(`Lost lease while completing job ${job.id}`);
      await this.store.appendAudit({
        userId: job.userId,
        eventType: "job.completed",
        resourceType: "job",
        resourceId: job.id,
        details: { jobType: job.jobType, attempts: job.attempts },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      const canRetry = job.attempts < job.maxAttempts && handler !== undefined;
      const retryAt = canRetry
        ? new Date(Date.now() + this.retryBaseMs * 2 ** Math.max(0, job.attempts - 1))
        : undefined;
      const status = await this.store.failJob({
        id: job.id,
        workerId: this.workerId,
        error: message.slice(0, 4_000),
        ...(retryAt ? { retryAt } : {}),
      });
      await this.store.appendAudit({
        userId: job.userId,
        eventType: status === "queued" ? "job.retry_scheduled" : "job.failed",
        resourceType: "job",
        resourceId: job.id,
        details: { jobType: job.jobType, attempts: job.attempts, error: message.slice(0, 500) },
      });
    }
  }
}
