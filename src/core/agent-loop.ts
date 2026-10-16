import type {
  AgentMessage,
  GenerateResult,
  ModelToolOutput,
  ToolCapableModelProvider,
} from "./models.js";
import type { ToolExecutionResult } from "../tools/executor.js";
import type { ModelToolDefinition } from "../tools/registry.js";

const MAX_OUTPUT_CHARS = 40_000;
const MAX_CALLS_PER_STEP = 4;

export interface AgentLoopResult {
  status: "completed" | "waiting_approval" | "step_limit" | "budget_limit";
  text: string;
  steps: number;
  toolExecutions: number;
  approvalIds: string[];
  result: GenerateResult;
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
      ].join(" "),
    }, ...input.messages];
    let previousResponseId: string | undefined;
    let toolOutputs: ModelToolOutput[] | undefined;
    let toolExecutions = 0;
    const approvalIds: string[] = [];
    let aggregateUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    let last: GenerateResult = { text: "", provider: this.model.name, model: "unknown" };

    for (let step = 1; step <= maxSteps; step += 1) {
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
      if (response.usage) {
        aggregateUsage.inputTokens += response.usage.inputTokens;
        aggregateUsage.outputTokens += response.usage.outputTokens;
        aggregateUsage.totalTokens += response.usage.totalTokens;
        aggregateUsage.costUsd += response.usage.costUsd ?? 0;
      }
      if (response.toolCalls.length === 0) {
        return this.finish("completed", response.text || "Задача завершена.", step, toolExecutions, approvalIds, last, aggregateUsage);
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
        const execution = await this.tools.execute({
          userId: input.userId,
          toolName: definition.toolName,
          toolInput: call.arguments,
          summary: `Barlas AI Agent requests ${definition.toolName}`,
        });
        toolExecutions += 1;
        if (execution.status === "pending_approval") {
          approvalIds.push(execution.approvalId);
          return this.finish(
            "waiting_approval",
            `Действие «${definition.toolName}» ожидает вашего подтверждения.`,
            step,
            toolExecutions,
            approvalIds,
            last,
            aggregateUsage,
          );
        }
        const output = execution.status === "completed"
          ? JSON.stringify(execution.output)
          : JSON.stringify({ rejected: true });
        toolOutputs.push({ callId: call.callId, output: (output ?? "null").slice(0, MAX_OUTPUT_CHARS) });
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
