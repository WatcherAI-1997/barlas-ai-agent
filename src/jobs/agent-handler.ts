import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ModelProvider } from "../core/models.js";
import type { DurableJob } from "../storage/types.js";
import type { JobHandler } from "./worker.js";

export const agentJobSchema = z.object({
  objective: z.string().min(1).max(20_000),
  context: z.string().max(50_000).optional(),
  taskClass: z.enum(["fast", "deep", "private"]).default("deep"),
}).strict();

export function createAgentJobHandler(modelProvider: ModelProvider): JobHandler {
  return async (job: DurableJob) => {
    const input = agentJobSchema.parse(job.input);
    const result = await modelProvider.generate({
      userId: job.userId,
      conversationId: randomUUID(),
      taskClass: input.taskClass,
      messages: [
        {
          role: "system",
          content: [
            "You are an isolated background worker of Barlas AI Agent.",
            "Complete only the supplied objective. Do not claim to perform external actions.",
            "Return a concise result suitable for durable storage.",
          ].join(" "),
        },
        {
          role: "user",
          content: input.context
            ? `Objective:\n${input.objective}\n\nContext:\n${input.context}`
            : `Objective:\n${input.objective}`,
        },
      ],
    });
    return {
      text: result.text,
      model: result.model,
      provider: result.provider,
      responseId: result.responseId,
    };
  };
}
