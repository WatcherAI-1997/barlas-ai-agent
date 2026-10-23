import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "../src/core/models.js";
import { SubagentCoordinator } from "../src/core/subagents.js";

describe("autonomous subagent delegation", () => {
  it("runs three bounded independent tasks and aggregates usage", async () => {
    let active = 0;
    let peak = 0;
    const model: ModelProvider = {
      name: "test",
      generate: vi.fn(async (request) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const prompt = request.messages.at(-1)?.content ?? "";
        return {
          text: `Finding for ${prompt.match(/Assigned task \(([^)]+)/u)?.[1] ?? "task"}`,
          provider: "test",
          model: "test-model",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
        };
      }),
    };
    const result = await new SubagentCoordinator(model).delegate({
      userId: "user-1",
      objective: "Compare three approaches",
      tasks: [
        { name: "security", instruction: "Assess security" },
        { name: "cost", instruction: "Assess cost" },
        { name: "operations", instruction: "Assess operations" },
      ],
    });

    expect(peak).toBe(3);
    expect(result.results.map((item) => item.name)).toEqual(["security", "cost", "operations"]);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45, costUsd: 0.003 });
    expect(model.generate).toHaveBeenCalledTimes(3);
  });

  it("rejects duplicate names and more than five tasks", async () => {
    const coordinator = new SubagentCoordinator({ name: "test", generate: vi.fn() });
    await expect(coordinator.delegate({
      userId: "user-1", objective: "x",
      tasks: [{ name: "same", instruction: "one" }, { name: "same", instruction: "two" }],
    })).rejects.toThrow(/unique/u);
    await expect(coordinator.delegate({
      userId: "user-1", objective: "x",
      tasks: Array.from({ length: 6 }, (_value, index) => ({ name: `task-${index}`, instruction: "work" })),
    })).rejects.toThrow(/1 to 5/u);
  });

  it("gives named council members distinct characters and authority boundaries", async () => {
    const model: ModelProvider = {
      name: "test",
      generate: vi.fn(async (request) => ({
        text: request.messages[0]?.content ?? "",
        provider: "test",
        model: "test-model",
      })),
    };
    const result = await new SubagentCoordinator(model).delegate({
      userId: "owner",
      objective: "Review a launch",
      tasks: [
        { name: "plan", role: "strategist", instruction: "Plan it" },
        { name: "safety", role: "guardian", instruction: "Check it" },
      ],
    });
    expect(result.results).toEqual([
      expect.objectContaining({ role: "strategist", text: expect.stringContaining("long-range") }),
      expect.objectContaining({ role: "guardian", text: expect.stringContaining("consent") }),
    ]);
  });
});
