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
    skillVersion: z.string().regex(/^\d+\.\d+\.\d+$/u).optional(),
    dependsOn: z.array(z.string().min(1).max(100)).max(6).optional(),
    instruction: z.string().min(1).max(10_000),
  }).strict()).min(1).max(6),
}).strict().superRefine((workflow, context) => {
  const seen = new Set<string>();
  workflow.steps.forEach((step, index) => {
    if (seen.has(step.name)) {
      context.addIssue({ code: "custom", path: ["steps", index, "name"], message: "Step names must be unique" });
    }
    for (const dependency of step.dependsOn ?? (index > 0 ? [workflow.steps[index - 1]!.name] : [])) {
      if (!seen.has(dependency)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "dependsOn"],
          message: "Dependencies must reference earlier steps",
        });
      }
    }
    seen.add(step.name);
  });
});

export function createWorkflowJobHandler(
  modelProvider: ModelProvider,
  skills: SkillRegistry,
): JobHandler {
  return async (job: DurableJob) => {
    const input = workflowJobSchema.parse(job.input);
    const completed = new Map<string, { name: string; skill: string; version: string; output: string }>();
    const pending = new Set(input.steps.map((step) => step.name));
    while (pending.size > 0) {
      const ready = input.steps.filter((step, index) => {
        if (!pending.has(step.name)) return false;
        const dependencies = step.dependsOn ?? (index > 0 ? [input.steps[index - 1]!.name] : []);
        return dependencies.every((dependency) => completed.has(dependency));
      }).slice(0, 3);
      if (ready.length === 0) throw new Error("Workflow dependency graph cannot make progress");

      const results = await Promise.all(ready.map(async (step) => {
        const skill = skills.get(step.skillId, step.skillVersion);
        const dependencies = step.dependsOn ?? (() => {
          const index = input.steps.indexOf(step);
          return index > 0 ? [input.steps[index - 1]!.name] : [];
        })();
        const dependencyOutputs = dependencies.map((name) => completed.get(name)!);
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
                dependencyOutputs.length > 0
                  ? `Dependency outputs:\n${dependencyOutputs.map((item) => `## ${item.name}\n${item.output}`).join("\n\n")}`
                  : undefined,
                `Current step (${step.name}):\n${step.instruction}`,
              ].filter(Boolean).join("\n\n"),
            },
          ],
        });
        return { name: step.name, skill: skill.id, version: skill.version, output: result.text };
      }));
      for (const result of results) {
        completed.set(result.name, result);
        pending.delete(result.name);
      }
    }

    const ordered = input.steps.map((step) => completed.get(step.name)!);
    return { objective: input.objective, steps: ordered, final: ordered.at(-1)?.output ?? "" };
  };
}
