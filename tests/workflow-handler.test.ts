import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "../src/core/models.js";
import { createWorkflowJobHandler } from "../src/jobs/workflow-handler.js";
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
});
