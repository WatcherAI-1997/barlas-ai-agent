import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "../src/core/models.js";
import { createWorkflowJobHandler, workflowJobSchema } from "../src/jobs/workflow-handler.js";
import { createBuiltinSkillRegistry } from "../src/skills/registry.js";
import type { DurableJob } from "../src/storage/types.js";

describe("Barlas AI Agent managed workflows", () => {
  it("runs bounded versioned skill steps in order", async () => {
    const generate = vi.fn<ModelProvider["generate"]>(async (request) => ({
      text: `result-${request.messages.at(-1)?.content.includes("Draft") ? "2" : "1"}`,
      provider: "test",
      model: "test-model",
    }));
    const handler = createWorkflowJobHandler({ name: "test", generate }, createBuiltinSkillRegistry());
    const job: DurableJob = {
      id: "00000000-0000-4000-8000-000000000020",
      userId: "user-1",
      jobType: "agent.workflow",
      input: {
        objective: "Prepare a brief",
        context: "Verified input",
        steps: [
          { name: "Research", skillId: "research.summary", instruction: "Extract findings" },
          { name: "Draft", skillId: "writing.brief", instruction: "Draft the brief" },
        ],
      },
      status: "running",
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 1,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
    };

    await expect(handler(job)).resolves.toMatchObject({
      objective: "Prepare a brief",
      final: "result-2",
      steps: [
        { name: "Research", skill: "research.summary", version: "1.0.0" },
        { name: "Draft", skill: "writing.brief", version: "1.0.0" },
      ],
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].messages.at(-1)?.content).toContain("result-1");
  });

  it("rejects workflows that reference unknown skills", async () => {
    const handler = createWorkflowJobHandler({
      name: "test",
      generate: vi.fn(async () => ({ text: "unused", provider: "test", model: "test" })),
    }, createBuiltinSkillRegistry());
    const job = {
      id: "00000000-0000-4000-8000-000000000021",
      userId: "user-1",
      jobType: "agent.workflow",
      input: {
        objective: "Do work",
        steps: [{ name: "Unknown", skillId: "unknown.skill", instruction: "Run" }],
      },
      status: "running",
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 1,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
    } satisfies DurableJob;

    await expect(handler(job)).rejects.toThrow("Unknown skill");
  });

  it("runs independent subagents in parallel and joins their named outputs", async () => {
    let active = 0;
    let maximumActive = 0;
    const generate = vi.fn<ModelProvider["generate"]>(async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const content = request.messages.at(-1)?.content ?? "";
      return {
        text: content.includes("Synthesize") ? "joined" : content.includes("Research A") ? "finding-a" : "finding-b",
        provider: "test",
        model: "test-model",
      };
    });
    const handler = createWorkflowJobHandler({ name: "test", generate }, createBuiltinSkillRegistry());
    const job = {
      id: "00000000-0000-4000-8000-000000000022",
      userId: "user-1",
      jobType: "agent.workflow",
      input: {
        objective: "Parallel research",
        steps: [
          { name: "Research A", skillId: "research.summary", instruction: "Research A", dependsOn: [] },
          { name: "Research B", skillId: "research.summary", instruction: "Research B", dependsOn: [] },
          {
            name: "Synthesis",
            skillId: "writing.brief",
            instruction: "Synthesize",
            dependsOn: ["Research A", "Research B"],
          },
        ],
      },
      status: "running",
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 1,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
    } satisfies DurableJob;

    const result = await handler(job) as { final: string };
    expect(result.final).toBe("joined");
    expect(maximumActive).toBe(2);
    expect(generate.mock.calls[2]?.[0].messages.at(-1)?.content).toContain("finding-a");
    expect(generate.mock.calls[2]?.[0].messages.at(-1)?.content).toContain("finding-b");
  });

  it("rejects duplicate, forward, and cyclic dependency shapes", () => {
    expect(() => workflowJobSchema.parse({ objective: "Invalid", steps: [
      { name: "A", skillId: "research.summary", instruction: "one", dependsOn: ["B"] },
      { name: "B", skillId: "writing.brief", instruction: "two", dependsOn: ["A"] },
    ] })).toThrow();
  });
});
