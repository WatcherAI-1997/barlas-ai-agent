import { readFile } from "node:fs/promises";

import { createEvaluationReport, evaluateScenario, parseEvaluationScenarios } from "../dist/src/evaluation/scoring.js";

const baseUrl = required("BARLAS_EVAL_BASE_URL").replace(/\/$/u, "");
const token = required("BARLAS_EVAL_TOKEN");
const userId = required("BARLAS_EVAL_USER_ID");
const scenarioPath = process.env.BARLAS_EVAL_SCENARIOS || "evals/live-agent.json";
const scenarios = parseEvaluationScenarios(JSON.parse(await readFile(scenarioPath, "utf8")));
const terminal = new Set(["completed", "waiting_approval", "step_limit", "budget_limit", "cancelled", "failed"]);
const results = [];

for (const scenario of scenarios) {
  const started = await api("/v1/agent/run", {
    method: "POST",
    body: JSON.stringify({
      userId,
      messages: [{ role: "user", content: scenario.prompt }],
      taskClass: scenario.taskClass,
      allowedTools: scenario.allowedTools,
      maxSteps: scenario.maxSteps,
      maxTotalTokens: scenario.maxTotalTokens,
    }),
  });
  if (!started.runId) throw new Error(`Scenario ${scenario.id} did not return a run ID`);
  const deadline = Date.now() + scenario.timeoutSeconds * 1000;
  let run;
  while (Date.now() < deadline) {
    run = (await api(`/v1/agent-runs/${started.runId}?userId=${encodeURIComponent(userId)}`)).run;
    if (terminal.has(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!run || !terminal.has(run.status)) throw new Error(`Scenario ${scenario.id} timed out`);
  const events = (await api(`/v1/agent-runs/${started.runId}/events?userId=${encodeURIComponent(userId)}`)).events;
  const loopResult = run.result;
  const observation = {
    status: run.status,
    output: loopResult?.text || run.error || "",
    steps: loopResult?.steps || 0,
    toolExecutions: loopResult?.toolExecutions || 0,
    totalTokens: loopResult?.result?.usage?.totalTokens || 0,
    costUsd: loopResult?.result?.usage?.costUsd || 0,
    events,
  };
  const result = evaluateScenario(scenario, observation);
  results.push(result);
  process.stderr.write(`${result.passed ? "PASS" : "FAIL"} ${scenario.id} ${(result.score * 100).toFixed(1)}%\n`);
  if (run.status === "waiting_approval" && run.pendingApprovalId) {
    const cleanup = await api(`/v1/approvals/${run.pendingApprovalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ userId, approved: false }),
    });
    if (cleanup.status !== "rejected") throw new Error(`Scenario ${scenario.id} approval cleanup failed`);
    process.stderr.write(`CLEANUP ${scenario.id} rejected pending action ${run.pendingApprovalId}\n`);
  }
}

const report = createEvaluationReport(results);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body.error || body.message || `HTTP ${response.status}`}`);
  return body;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
