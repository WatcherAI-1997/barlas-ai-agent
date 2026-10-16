import type { AgentRunEvent, AgentRunStatus } from "../runs/types.js";
import { z } from "zod";

export interface AgentEvaluationExpectation {
  statuses: AgentRunStatus[];
  requiredTools?: string[];
  forbiddenTools?: string[];
  requiredEvents?: string[];
  outputIncludes?: string[];
  outputExcludes?: string[];
  minSteps?: number;
  maxSteps?: number;
  minToolExecutions?: number;
  maxToolExecutions?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
}

export interface AgentEvaluationScenario {
  id: string;
  title: string;
  prompt: string;
  taskClass: "fast" | "deep" | "private";
  allowedTools?: string[];
  maxSteps: number;
  maxTotalTokens: number;
  timeoutSeconds: number;
  expect: AgentEvaluationExpectation;
}

export interface AgentEvaluationObservation {
  status: AgentRunStatus;
  output: string;
  steps: number;
  toolExecutions: number;
  totalTokens: number;
  costUsd: number;
  events: AgentRunEvent[];
}

export interface EvaluationCheck {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface AgentEvaluationResult {
  scenarioId: string;
  title: string;
  passed: boolean;
  score: number;
  checks: EvaluationCheck[];
  observation: AgentEvaluationObservation;
}

export interface AgentEvaluationReport {
  product: "Barlas AI Agent";
  createdAt: string;
  passed: boolean;
  passedScenarios: number;
  totalScenarios: number;
  score: number;
  results: AgentEvaluationResult[];
}

const statusSchema = z.enum(["queued", "running", "completed", "waiting_approval", "step_limit", "budget_limit", "cancelled", "failed"]);
const expectationSchema = z.object({
  statuses: z.array(statusSchema).min(1).max(8),
  requiredTools: z.array(z.string().min(1).max(128)).max(32).optional(),
  forbiddenTools: z.array(z.string().min(1).max(128)).max(32).optional(),
  requiredEvents: z.array(z.string().min(1).max(128)).max(32).optional(),
  outputIncludes: z.array(z.string().min(1).max(500)).max(20).optional(),
  outputExcludes: z.array(z.string().min(1).max(500)).max(20).optional(),
  minSteps: z.number().int().min(0).max(12).optional(),
  maxSteps: z.number().int().min(0).max(12).optional(),
  minToolExecutions: z.number().int().min(0).max(12).optional(),
  maxToolExecutions: z.number().int().min(0).max(12).optional(),
  maxTotalTokens: z.number().int().min(0).max(1_000_000).optional(),
  maxCostUsd: z.number().min(0).max(10_000).optional(),
}).strict();
const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/u),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(20_000),
  taskClass: z.enum(["fast", "deep", "private"]),
  allowedTools: z.array(z.string().min(1).max(128)).max(32).optional(),
  maxSteps: z.number().int().min(1).max(12),
  maxTotalTokens: z.number().int().min(1_000).max(100_000),
  timeoutSeconds: z.number().int().min(5).max(3_600),
  expect: expectationSchema,
}).strict();

export function parseEvaluationScenarios(value: unknown): AgentEvaluationScenario[] {
  const scenarios = z.array(scenarioSchema).min(1).max(50).parse(value) as AgentEvaluationScenario[];
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    throw new Error("Evaluation scenario IDs must be unique");
  }
  for (const scenario of scenarios) {
    if (scenario.expect.minSteps !== undefined && scenario.expect.maxSteps !== undefined && scenario.expect.minSteps > scenario.expect.maxSteps) {
      throw new Error(`Evaluation scenario ${scenario.id} has an invalid step range`);
    }
    if (scenario.expect.maxSteps !== undefined && scenario.expect.maxSteps > scenario.maxSteps) {
      throw new Error(`Evaluation scenario ${scenario.id} expects more steps than it permits`);
    }
  }
  return scenarios;
}

export function evaluateScenario(
  scenario: AgentEvaluationScenario,
  observation: AgentEvaluationObservation,
): AgentEvaluationResult {
  const checks: EvaluationCheck[] = [];
  const add = (name: string, passed: boolean, expected: unknown, actual: unknown) => {
    checks.push({ name, passed, expected, actual });
  };
  const expected = scenario.expect;
  const toolNames = observation.events
    .map((event) => event.details)
    .flatMap((details) => details && typeof details === "object" && "toolName" in details
      ? [String((details as { toolName: unknown }).toolName)]
      : []);
  const eventNames = observation.events.map((event) => event.eventType);
  const normalizedOutput = observation.output.toLocaleLowerCase("en-US");

  add("terminal_status", expected.statuses.includes(observation.status), expected.statuses, observation.status);
  if (expected.minSteps !== undefined) add("minimum_steps", observation.steps >= expected.minSteps, expected.minSteps, observation.steps);
  if (expected.maxSteps !== undefined) add("maximum_steps", observation.steps <= expected.maxSteps, expected.maxSteps, observation.steps);
  if (expected.minToolExecutions !== undefined) {
    add("minimum_tool_executions", observation.toolExecutions >= expected.minToolExecutions, expected.minToolExecutions, observation.toolExecutions);
  }
  if (expected.maxToolExecutions !== undefined) {
    add("maximum_tool_executions", observation.toolExecutions <= expected.maxToolExecutions, expected.maxToolExecutions, observation.toolExecutions);
  }
  for (const tool of expected.requiredTools ?? []) add(`required_tool:${tool}`, toolNames.includes(tool), tool, toolNames);
  for (const tool of expected.forbiddenTools ?? []) add(`forbidden_tool:${tool}`, !toolNames.includes(tool), `not ${tool}`, toolNames);
  for (const event of expected.requiredEvents ?? []) add(`required_event:${event}`, eventNames.includes(event), event, eventNames);
  for (const text of expected.outputIncludes ?? []) {
    add(`output_includes:${text}`, normalizedOutput.includes(text.toLocaleLowerCase("en-US")), text, observation.output);
  }
  for (const text of expected.outputExcludes ?? []) {
    add(`output_excludes:${text}`, !normalizedOutput.includes(text.toLocaleLowerCase("en-US")), `not ${text}`, observation.output);
  }
  if (expected.maxTotalTokens !== undefined) {
    add("token_budget", observation.totalTokens <= expected.maxTotalTokens, expected.maxTotalTokens, observation.totalTokens);
  }
  if (expected.maxCostUsd !== undefined) add("cost_budget", observation.costUsd <= expected.maxCostUsd, expected.maxCostUsd, observation.costUsd);

  const passedChecks = checks.filter((check) => check.passed).length;
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    passed: checks.length > 0 && passedChecks === checks.length,
    score: checks.length === 0 ? 0 : passedChecks / checks.length,
    checks,
    observation,
  };
}

export function createEvaluationReport(results: AgentEvaluationResult[], createdAt = new Date().toISOString()): AgentEvaluationReport {
  const passedScenarios = results.filter((result) => result.passed).length;
  return {
    product: "Barlas AI Agent",
    createdAt,
    passed: results.length > 0 && passedScenarios === results.length,
    passedScenarios,
    totalScenarios: results.length,
    score: results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / results.length,
    results,
  };
}
