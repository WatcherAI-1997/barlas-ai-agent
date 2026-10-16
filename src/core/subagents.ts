import { randomUUID } from "node:crypto";

import type { ModelProvider } from "./models.js";

const MAX_SUBAGENTS = 3;
const MAX_RESULT_CHARS = 30_000;

export interface DelegatedTask {
  name: string;
  instruction: string;
  context?: string;
}

export interface DelegationResult {
  objective: string;
  results: Array<{
    name: string;
    text: string;
    provider: string;
    model: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd?: number };
    truncated: boolean;
  }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
}

export class SubagentCoordinator {
  constructor(private readonly model: ModelProvider) {}

  async delegate(input: {
    userId: string;
    objective: string;
    tasks: DelegatedTask[];
    taskClass?: "fast" | "deep" | "private";
  }): Promise<DelegationResult> {
    if (input.tasks.length < 1 || input.tasks.length > MAX_SUBAGENTS) {
      throw new Error(`Delegation requires 1 to ${MAX_SUBAGENTS} tasks`);
    }
    const names = new Set(input.tasks.map((task) => task.name));
    if (names.size !== input.tasks.length) throw new Error("Delegated task names must be unique");

    const results = await Promise.all(input.tasks.map(async (task) => {
      const result = await this.model.generate({
        userId: input.userId,
        conversationId: randomUUID(),
        taskClass: input.taskClass ?? "deep",
        maxOutputTokens: 2_048,
        messages: [
          {
            role: "system",
            content: [
              "You are an isolated Barlas AI Agent subagent.",
              "Complete only the assigned analytical task from supplied context.",
              "You have no tools, cannot delegate, and must not claim external actions.",
              "Separate verified facts, assumptions, uncertainties, and recommended next steps.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Parent objective:\n${input.objective}`,
              `Assigned task (${task.name}):\n${task.instruction}`,
              task.context ? `Supplied context:\n${task.context}` : undefined,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });
      return {
        name: task.name,
        text: result.text.slice(0, MAX_RESULT_CHARS),
        provider: result.provider,
        model: result.model,
        ...(result.usage ? { usage: result.usage } : {}),
        truncated: result.text.length > MAX_RESULT_CHARS,
      };
    }));

    return {
      objective: input.objective,
      results,
      usage: results.reduce((total, result) => ({
        inputTokens: total.inputTokens + (result.usage?.inputTokens ?? 0),
        outputTokens: total.outputTokens + (result.usage?.outputTokens ?? 0),
        totalTokens: total.totalTokens + (result.usage?.totalTokens ?? 0),
        costUsd: total.costUsd + (result.usage?.costUsd ?? 0),
      }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }),
    };
  }
}
