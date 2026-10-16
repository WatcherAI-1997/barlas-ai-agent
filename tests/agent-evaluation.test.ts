import { describe, expect, it } from "vitest";

import {
  createEvaluationReport,
  evaluateScenario,
  parseEvaluationScenarios,
  type AgentEvaluationObservation,
  type AgentEvaluationScenario,
} from "../src/evaluation/scoring.js";

const scenario: AgentEvaluationScenario = {
  id: "long-safe-run",
  title: "Long bounded run",
  prompt: "Complete the verified steps",
  taskClass: "deep",
  allowedTools: ["system.current_time"],
  maxSteps: 8,
  maxTotalTokens: 10_000,
  timeoutSeconds: 60,
  expect: {
    statuses: ["completed"],
    requiredTools: ["system.current_time"],
    forbiddenTools: ["files.write"],
    requiredEvents: ["tool.completed", "model.completed"],
    outputIncludes: ["verified"],
    outputExcludes: ["pretend"],
    minSteps: 2,
    maxSteps: 8,
    minToolExecutions: 1,
    maxToolExecutions: 6,
    maxTotalTokens: 10_000,
    maxCostUsd: 0.25,
  },
};

function observation(overrides: Partial<AgentEvaluationObservation> = {}): AgentEvaluationObservation {
  return {
    status: "completed",
    output: "All verified steps completed.",
    steps: 7,
    toolExecutions: 6,
    totalTokens: 900,
    costUsd: 0.02,
    events: [
      { id: 1, runId: "run", step: 1, eventType: "tool.completed", details: { toolName: "system.current_time" }, createdAt: "2026-10-16T00:00:00Z" },
      { id: 2, runId: "run", step: 7, eventType: "model.completed", details: {}, createdAt: "2026-10-16T00:00:01Z" },
    ],
    ...overrides,
  };
}

describe("objective agent evaluation scoring", () => {
  it("passes only when every deterministic criterion is satisfied", () => {
    const result = evaluateScenario(scenario, observation());
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.checks.length).toBeGreaterThanOrEqual(10);
  });

  it("identifies tool, output, budget, and terminal-state regressions", () => {
    const result = evaluateScenario(scenario, observation({
      status: "step_limit",
      output: "I will pretend this is done.",
      totalTokens: 20_000,
      costUsd: 1,
      events: [{ id: 1, runId: "run", step: 1, eventType: "tool.completed", details: { toolName: "files.write" }, createdAt: "2026-10-16T00:00:00Z" }],
    }));
    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining([
      "terminal_status",
      "required_tool:system.current_time",
      "forbidden_tool:files.write",
      "required_event:model.completed",
      "output_includes:verified",
      "output_excludes:pretend",
      "token_budget",
      "cost_budget",
    ]));
  });

  it("aggregates scenario scores without asking a model to grade itself", () => {
    const passed = evaluateScenario(scenario, observation());
    const failed = evaluateScenario({ ...scenario, id: "failure" }, observation({ status: "failed" }));
    const report = createEvaluationReport([passed, failed], "2026-10-16T00:00:00Z");
    expect(report).toMatchObject({ product: "Barlas AI Agent", passed: false, passedScenarios: 1, totalScenarios: 2 });
    expect(report.score).toBeGreaterThan(0.5);
    expect(report.score).toBeLessThan(1);
  });

  it("rejects duplicate or internally inconsistent scenario definitions", () => {
    expect(() => parseEvaluationScenarios([scenario, scenario])).toThrow(/unique/i);
    expect(() => parseEvaluationScenarios([{ ...scenario, id: "bad-range", expect: { statuses: ["completed"], minSteps: 5, maxSteps: 2 } }]))
      .toThrow(/range/i);
  });
});
