import type { DashboardStats } from "../storage/types.js";

export interface OperationalMetricsSnapshot {
  uptimeSeconds: number;
  workerEnabled: boolean;
  stats: DashboardStats;
}

function metric(
  name: string,
  help: string,
  type: "counter" | "gauge",
  value: number,
): string[] {
  if (!Number.isFinite(value)) throw new Error(`Metric ${name} is not finite`);
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`];
}

export function renderPrometheusMetrics(snapshot: OperationalMetricsSnapshot): string {
  const { stats } = snapshot;
  return [
    ...metric("barlas_up", "Whether the Barlas API and database stats query are available.", "gauge", 1),
    ...metric("barlas_uptime_seconds", "Process uptime in seconds.", "gauge", Math.max(0, Math.floor(snapshot.uptimeSeconds))),
    ...metric("barlas_worker_enabled", "Whether background workers are enabled in this process.", "gauge", snapshot.workerEnabled ? 1 : 0),
    ...metric("barlas_conversations", "Current number of conversations.", "gauge", stats.conversations),
    ...metric("barlas_messages", "Current number of stored messages.", "gauge", stats.messages),
    ...metric("barlas_jobs_active", "Current number of queued, running, or waiting jobs.", "gauge", stats.queuedJobs),
    ...metric("barlas_jobs_failed", "Current number of failed jobs.", "gauge", stats.failedJobs),
    ...metric("barlas_approvals_pending", "Current number of approval requests awaiting a decision.", "gauge", stats.pendingApprovals),
    ...metric("barlas_model_input_tokens_total", "Stored model input tokens.", "counter", stats.inputTokens),
    ...metric("barlas_model_output_tokens_total", "Stored model output tokens.", "counter", stats.outputTokens),
    ...metric("barlas_model_tokens_total", "Stored model tokens.", "counter", stats.totalTokens),
    ...metric("barlas_estimated_cost_usd_total", "Stored estimated model cost in US dollars.", "counter", stats.estimatedCostUsd),
    "",
  ].join("\n");
}
