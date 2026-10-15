import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ModelProvider } from "../core/models.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { DurableJob } from "../storage/types.js";
import type { JobHandler } from "./worker.js";

export const workflowJobSchema = z.object({
  objective: z.string().min(1).max(20_000),
  context: z.string().max(50_000).optional(),
  taskClass: z.enum(["fast", "deep", "private"]).default("deep"),
  steps: z.array(z.object({
    name: z.string().min(1).max(100),
    skillId: z.string().min(3).max(64),
    instruction: z.string().min(1).max(10_000),
  }).strict()).min(1).max(6),
}).strict();

export function createWorkflowJobHandler(
  modelProvider: ModelProvider,
  skills: SkillRegistry,
): JobHandler {
  return async (job: DurableJob) => {
    const input = workflowJobSchema.parse(job.input);
    const completed: Array<{ name: string; skill: string; version: string; output: string }> = [];

    for (const step of input.steps) {
      const skill = skills.get(step.skillId);
      const previous = completed.at(-1)?.output;
      const result = await modelProvider.generate({
        userId: job.userId,
        conversationId: randomUUID(),
        taskClass: input.taskClass,
        messages: [
          {
            role: "system",
            content: [
              "You are a bounded subagent in a Barlas AI Agent workflow.",
              `Skill: ${skill.id}@${skill.version}.`,
              skill.instructions,
              "Work only from the supplied context. Do not claim external actions or delegate further.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow objective:\n${input.objective}`,
              input.context ? `Initial context:\n${input.context}` : undefined,
              previous ? `Previous step output:\n${previous}` : undefined,
              `Current step (${step.name}):\n${step.instruction}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });
      completed.push({ name: step.name, skill: skill.id, version: skill.version, output: result.text });
    }

    return { objective: input.objective, steps: completed, final: completed.at(-1)?.output ?? "" };
  };
}
