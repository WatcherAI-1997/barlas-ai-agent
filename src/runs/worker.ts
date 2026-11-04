import { randomUUID } from "node:crypto";

import type { AgentRunRecord, AgentRunStore } from "./types.js";
import type { PersistentAgentRuntime } from "./runtime.js";

export class AgentRunWorker {
  readonly workerId: string;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;

  constructor(
    private readonly store: AgentRunStore,
    private readonly runtime: Pick<PersistentAgentRuntime, "executeClaimed">,
    private readonly options: {
      workerId?: string;
      pollIntervalMs?: number;
      leaseSeconds?: number;
      batchSize?: number;
      retryBaseMs?: number;
      leaseHeartbeatMs?: number;
      onFinished?: (run: AgentRunRecord) => Promise<void>;
      onError?: (error: unknown) => void;
      isPaused?: () => Promise<boolean>;
    } = {},
  ) {
    this.workerId = options.workerId ?? `barlas-agent-run-worker-${randomUUID()}`;
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
    if (await this.options.isPaused?.()) return 0;
    const runs = await this.store.claimAgentRuns({
      workerId: this.workerId,
      limit: this.options.batchSize ?? 2,
      leaseSeconds: this.options.leaseSeconds ?? 300,
    });
    await Promise.all(runs.map((run) => this.process(run)));
    return runs.length;
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
      if (!this.stopping) {
        this.timer = setTimeout(() => void this.tick(), this.options.pollIntervalMs ?? 1_000);
        this.timer.unref();
      }
    }
  }

  private async process(run: AgentRunRecord): Promise<void> {
    const lease = this.startLeaseHeartbeat(run);
    try {
      await this.store.appendAgentRunEvent({ runId: run.id, step: 0, eventType: "run.started", details: { attempt: run.attempts } });
      const finished = await this.runtime.executeClaimed(run, lease.lost);
      await lease.stop();
      await this.options.onFinished?.(finished);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agent run failure";
      const retryAt = run.attempts < run.maxAttempts
        ? new Date(Date.now() + (this.options.retryBaseMs ?? 2_000) * 2 ** Math.max(0, run.attempts - 1))
        : undefined;
      const status = await this.store.failClaimedAgentRun({
        id: run.id,
        workerId: this.workerId,
        error: message.slice(0, 4_000),
        ...(retryAt ? { retryAt } : {}),
      });
      if (status === null) {
        const current = await this.store.getAgentRun(run.userId, run.id);
        if (current?.status === "cancelled") {
          await this.store.appendAgentRunEvent({ runId: run.id, step: 0, eventType: "run.cancelled" });
          return;
        }
        if (lease.lost() && current?.status === "running" && current.workerId !== this.workerId) {
          await this.store.appendAgentRunEvent({
            runId: run.id,
            step: 0,
            eventType: "run.lease_lost",
            details: { attempt: run.attempts },
          });
          return;
        }
        if (current && current.status !== "running") return;
      }
      await this.store.appendAgentRunEvent({
        runId: run.id,
        step: 0,
        eventType: status === "queued" ? "run.retry_scheduled" : "run.failed",
        details: { attempt: run.attempts, error: message.slice(0, 500) },
      });
      this.options.onError?.(error);
    } finally {
      await lease.stop();
    }
  }

  private startLeaseHeartbeat(run: AgentRunRecord): {
    lost: () => boolean;
    stop: () => Promise<void>;
  } {
    const leaseSeconds = Math.max(3, this.options.leaseSeconds ?? 300);
    const intervalMs = this.options.leaseHeartbeatMs === undefined
      ? Math.max(250, Math.floor(leaseSeconds * 1_000 / 3))
      : Math.max(1, this.options.leaseHeartbeatMs);
    let stopped = false;
    let lost = false;
    let timer: NodeJS.Timeout | undefined;
    let inFlight = Promise.resolve();

    const schedule = () => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        inFlight = (async () => {
          try {
            const renewed = await this.store.renewAgentRunLease({
              id: run.id,
              workerId: this.workerId,
              leaseSeconds,
            });
            if (!renewed) {
              lost = true;
              return;
            }
          } catch (error) {
            lost = true;
            this.options.onError?.(error);
            return;
          }
          schedule();
        })();
      }, intervalMs);
      timer.unref();
    };

    schedule();
    return {
      lost: () => lost,
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inFlight;
      },
    };
  }
}
