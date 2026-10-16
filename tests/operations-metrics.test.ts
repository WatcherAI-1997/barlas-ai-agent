import { describe, expect, it } from "vitest";

import { renderPrometheusMetrics } from "../src/operations/metrics.js";

describe("Prometheus operations metrics", () => {
  it("renders a bounded label-free Prometheus snapshot", () => {
    const output = renderPrometheusMetrics({
      uptimeSeconds: 12.9,
      workerEnabled: true,
      stats: {
        conversations: 2,
        messages: 7,
        queuedJobs: 3,
        failedJobs: 1,
        pendingApprovals: 4,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 0.012345,
      },
    });

    expect(output).toContain("# TYPE barlas_jobs_active gauge\nbarlas_jobs_active 3");
    expect(output).toContain("# TYPE barlas_model_tokens_total counter\nbarlas_model_tokens_total 150");
    expect(output).toContain("barlas_estimated_cost_usd_total 0.012345");
    expect(output).toContain("barlas_uptime_seconds 12");
    expect(output).toContain("barlas_worker_enabled 1");
    expect(output).not.toContain("{");
  });

  it("rejects non-finite values instead of emitting an invalid scrape", () => {
    expect(() => renderPrometheusMetrics({
      uptimeSeconds: 1,
      workerEnabled: false,
      stats: {
        conversations: Number.NaN,
        messages: 0,
        queuedJobs: 0,
        failedJobs: 0,
        pendingApprovals: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    })).toThrow(/not finite/u);
  });
});
