import type {
  AgentMessage,
  GenerateResult,
  ModelToolOutput,
  ToolCapableModelProvider,
} from "./models.js";
import type { ToolExecutionResult } from "../tools/executor.js";
import type { ModelToolDefinition } from "../tools/registry.js";

const MAX_OUTPUT_CHARS = 40_000;
const MAX_CALLS_PER_STEP = 1;
const MAX_REVIEW_OBJECTIVE_CHARS = 12_000;

const COGNITION_PROTOCOL = [
  "Operate with disciplined autonomy: understand the objective and constraints before acting.",
  "For non-trivial work, silently form a short plan, choose the smallest useful next action, and revise the plan when evidence changes.",
  "Use memory, project context, and tools as evidence; do not guess facts that can be checked.",
  "After every tool result, verify what actually changed and whether the objective is satisfied before continuing.",
  "Do not expose private chain-of-thought. Give the user concise conclusions, evidence, decisions, and any remaining uncertainty.",
  "If blocked, explain the exact blocker and the smallest decision or permission needed. Never bypass approvals or safety boundaries.",
].join(" ");

export interface AgentLoopResult {
  status: "completed" | "waiting_approval" | "step_limit" | "budget_limit" | "cancelled";
  text: string;
  steps: number;
  toolExecutions: number;
  approvalIds: string[];
  result: GenerateResult;
  continuation?: AgentLoopContinuation;
}

export interface AgentLoopContinuation {
  previousResponseId: string;
  pendingCallId?: string;
  steps: number;
  toolExecutions: number;
  approvalIds: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  last: GenerateResult;
  completedToolOutputs?: ModelToolOutput[];
}

export interface AgentLoopTools {
  listModelTools(allowedTools?: string[]): ModelToolDefinition[];
  execute(input: {
    userId: string;
    toolName: string;
    toolInput: unknown;
    summary: string;
  }): Promise<ToolExecutionResult>;
}

export class AgentLoop {
  constructor(
    private readonly model: ToolCapableModelProvider,
    private readonly tools: AgentLoopTools,
    private readonly defaultMaxSteps = 8,
    private readonly hardTokenBudget = 50_000,
    private readonly maxOutputTokensPerStep = 4_096,
  ) {}

  async run(input: {
    userId: string;
    conversationId: string;
    messages: AgentMessage[];
    taskClass?: "fast" | "deep" | "private";
    maxSteps?: number;
    maxTotalTokens?: number;
    allowedTools?: string[];
    continuation?: AgentLoopContinuation;
    toolOutputs?: ModelToolOutput[];
    shouldCancel?: () => Promise<boolean>;
    onStep?: (event: { step: number; type: string; details?: unknown }) => Promise<void>;
  }): Promise<AgentLoopResult> {
    const maxSteps = Math.min(Math.max(input.maxSteps ?? this.defaultMaxSteps, 1), 12);
    const tokenBudget = Math.min(Math.max(input.maxTotalTokens ?? this.hardTokenBudget, 1_000), this.hardTokenBudget);
    const definitions = this.tools.listModelTools(input.allowedTools);
    const byModelName = new Map(definitions.map((tool) => [tool.modelName, tool]));
    const modelTools = definitions.map((tool) => ({
      name: tool.modelName,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const messages: AgentMessage[] = [{
      role: "system",
      content: [
        "You are Barlas AI Agent operating in a bounded autonomous loop.",
        "Use only the provided tools. Never claim a tool succeeded before receiving its output.",
        "Risky tools pause for explicit user approval. If a tool is unnecessary, answer directly.",
        COGNITION_PROTOCOL,
      ].join(" "),
    }, ...input.messages];
    let previousResponseId = input.continuation?.previousResponseId;
    let toolOutputs = input.toolOutputs;
    let toolExecutions = input.continuation?.toolExecutions ?? 0;
    const approvalIds = [...(input.continuation?.approvalIds ?? [])];
    let aggregateUsage = input.continuation?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    let last: GenerateResult = input.continuation?.last ?? { text: "", provider: this.model.name, model: "unknown" };

    await input.onStep?.({
      step: input.continuation?.steps ?? 0,
      type: "cognition.observe",
      details: { availableTools: definitions.length, resumed: Boolean(input.continuation) },
    });

    for (let step = (input.continuation?.steps ?? 0) + 1; step <= maxSteps; step += 1) {
      if (await input.shouldCancel?.()) {
        return this.finish("cancelled", "Автономный запуск отменён.", step - 1, toolExecutions, approvalIds, last, aggregateUsage);
      }
      const response = await this.model.generateWithTools({
        userId: input.userId,
        conversationId: input.conversationId,
        messages,
        tools: modelTools,
        maxOutputTokens: this.maxOutputTokensPerStep,
        ...(input.taskClass ? { taskClass: input.taskClass } : {}),
        ...(previousResponseId ? { previousResponseId } : {}),
        ...(toolOutputs ? { toolOutputs } : {}),
      });
      last = response;
      await input.onStep?.({
        step,
        type: response.toolCalls.length > 0 ? "model.tool_calls" : "model.completed",
        details: { toolCount: response.toolCalls.length, provider: response.provider, model: response.model },
      });
      if (response.usage) {
        aggregateUsage.inputTokens += response.usage.inputTokens;
        aggregateUsage.outputTokens += response.usage.outputTokens;
        aggregateUsage.totalTokens += response.usage.totalTokens;
        aggregateUsage.costUsd += response.usage.costUsd ?? 0;
      }
      if (await input.shouldCancel?.()) {
        return this.finish("cancelled", "Автономный запуск отменён.", step, toolExecutions, approvalIds, last, aggregateUsage);
      }
      if (response.toolCalls.length === 0) {
        let finalText = response.text || "Задача завершена.";
        if (input.taskClass === "deep" && aggregateUsage.totalTokens < tokenBudget) {
          await input.onStep?.({ step, type: "cognition.review", details: { mode: "independent_completion_check" } });
          try {
            const review = await this.reviewAnswer(input, finalText, toolExecutions);
            if (review.usage) {
              aggregateUsage.inputTokens += review.usage.inputTokens;
              aggregateUsage.outputTokens += review.usage.outputTokens;
              aggregateUsage.totalTokens += review.usage.totalTokens;
              aggregateUsage.costUsd += review.usage.costUsd ?? 0;
            }
            const reviewed = parseReview(review.text);
            if (reviewed?.final) finalText = reviewed.final;
            await input.onStep?.({
              step,
              type: "cognition.reviewed",
              details: { verdict: reviewed?.verdict ?? "unstructured", issueCount: reviewed?.issues.length ?? 0 },
            });
          } catch {
            await input.onStep?.({ step, type: "cognition.reviewed", details: { verdict: "fallback", issueCount: 0 } });
          }
        }
        last = { ...last, text: finalText };
        await input.onStep?.({ step, type: "cognition.complete", details: { verified: toolExecutions > 0 } });
        return this.finish("completed", finalText, step, toolExecutions, approvalIds, last, aggregateUsage);
      }
      if (aggregateUsage.totalTokens >= tokenBudget) {
        return this.finish(
          "budget_limit",
          "Автономное выполнение остановлено: достигнут лимит токенов.",
          step,
          toolExecutions,
          approvalIds,
          last,
          aggregateUsage,
        );
      }
      if (response.toolCalls.length > MAX_CALLS_PER_STEP) {
        throw new Error(`Model requested too many tools in one step (maximum ${MAX_CALLS_PER_STEP})`);
      }
      previousResponseId = response.responseId;
      toolOutputs = [];
      for (const call of response.toolCalls) {
        const definition = byModelName.get(call.name);
        if (!definition) throw new Error(`Model requested an unavailable tool: ${call.name}`);
        await input.onStep?.({
          step,
          type: "cognition.act",
          details: { toolName: definition.toolName },
        });
        const execution = await this.tools.execute({
          userId: input.userId,
          toolName: definition.toolName,
          toolInput: call.arguments,
          summary: `Barlas AI Agent requests ${definition.toolName}`,
        });
        toolExecutions += 1;
        if (execution.status === "pending_approval") {
          approvalIds.push(execution.approvalId);
          const result = this.finish(
            "waiting_approval",
            `Действие «${definition.toolName}» ожидает вашего подтверждения.`,
            step,
            toolExecutions,
            approvalIds,
            last,
            aggregateUsage,
          );
          if (!previousResponseId) throw new Error("Model response ID is required for approval continuation");
          result.continuation = {
            previousResponseId,
            pendingCallId: call.callId,
            steps: step,
            toolExecutions,
            approvalIds,
            usage: aggregateUsage,
            last,
            ...(toolOutputs.length > 0 ? { completedToolOutputs: [...toolOutputs] } : {}),
          };
          await input.onStep?.({
            step,
            type: "approval.pending",
            details: { approvalId: execution.approvalId, toolName: definition.toolName },
          });
          await input.onStep?.({
            step,
            type: "cognition.blocked",
            details: { reason: "approval_required", toolName: definition.toolName },
          });
          return result;
        }
        const output = execution.status === "completed"
          ? JSON.stringify(execution.output)
          : JSON.stringify({ rejected: true });
        toolOutputs.push({ callId: call.callId, output: (output ?? "null").slice(0, MAX_OUTPUT_CHARS) });
        await input.onStep?.({ step, type: "tool.completed", details: { toolName: definition.toolName } });
        await input.onStep?.({
          step,
          type: "cognition.verify",
          details: { toolName: definition.toolName, outcome: execution.status },
        });
      }
    }
    return this.finish(
      "step_limit",
      "Автономное выполнение остановлено: достигнут безопасный лимит шагов.",
      maxSteps,
      toolExecutions,
      approvalIds,
      last,
      aggregateUsage,
    );
  }

  private reviewAnswer(
    input: { userId: string; conversationId: string; messages: AgentMessage[] },
    draft: string,
    toolExecutions: number,
  ): Promise<GenerateResult> {
    const objective = input.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n")
      .slice(-MAX_REVIEW_OBJECTIVE_CHARS);
    return this.model.generate({
      userId: input.userId,
      conversationId: input.conversationId,
      taskClass: "deep",
      maxOutputTokens: 2_048,
      messages: [
        {
          role: "system",
          content: "You are the independent completion auditor for Barlas AI Agent. Check the draft against the objective for omissions, unsupported claims, contradictions, and incomplete execution. Do not invent facts or actions. Return strict JSON only: {\"verdict\":\"pass\"|\"revise\",\"final\":\"best corrected user-facing answer\",\"issues\":[\"short issue\"]}. Keep final concise and preserve the user's language.",
        },
        {
          role: "user",
          content: JSON.stringify({ objective, draft: draft.slice(0, MAX_OUTPUT_CHARS), toolExecutions }),
        },
      ],
    });
  }

  private finish(
    status: AgentLoopResult["status"],
    text: string,
    steps: number,
    toolExecutions: number,
    approvalIds: string[],
    last: GenerateResult,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number },
  ): AgentLoopResult {
    return {
      status,
      text,
      steps,
      toolExecutions,
      approvalIds,
      result: {
        text,
        provider: last.provider,
        model: last.model,
        ...(last.responseId ? { responseId: last.responseId } : {}),
        usage,
      },
    };
  }
}

function parseReview(value: string): { verdict: "pass" | "revise"; final: string; issues: string[] } | null {
  try {
    const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as { verdict?: unknown; final?: unknown; issues?: unknown };
    if (!(["pass", "revise"] as unknown[]).includes(candidate.verdict) || typeof candidate.final !== "string") return null;
    if (!Array.isArray(candidate.issues) || candidate.issues.some((issue) => typeof issue !== "string")) return null;
    return {
      verdict: candidate.verdict as "pass" | "revise",
      final: candidate.final.slice(0, MAX_OUTPUT_CHARS),
      issues: candidate.issues.slice(0, 20) as string[],
    };
  } catch {
    return null;
  }
}
