import { describe, expect, it, vi } from "vitest";

import type { ModelProvider } from "../src/core/models.js";
import { SkillManager, type SkillEvaluation, type StoredSkill } from "../src/skills/manager.js";
import { SkillRegistry } from "../src/skills/registry.js";

describe("persistent skill manager", () => {
  it("installs candidates, evaluates them, and activates only a passing version", async () => {
    const skills: StoredSkill[] = [];
    const evaluations: SkillEvaluation[] = [];
    const store = {
      listSkillVersions: vi.fn(async () => skills),
      insertSkill: vi.fn(async (input: Omit<StoredSkill, "active" | "createdAt">) => {
        const skill = { ...input, active: false, createdAt: "2026-10-16T00:00:00.000Z" };
        skills.push(skill);
        return skill;
      }),
      saveSkillEvaluation: vi.fn(async (input: Omit<SkillEvaluation, "createdAt">) => {
        const evaluation = { ...input, createdAt: "2026-10-16T00:00:01.000Z" };
        evaluations.push(evaluation);
        return evaluation;
      }),
      latestSkillEvaluation: vi.fn(async (id: string, version: string) =>
        evaluations.filter((item) => item.skillId === id && item.skillVersion === version).at(-1) ?? null),
      activateSkill: vi.fn(async (id: string, version: string) => {
        const selected = skills.find((item) => item.id === id && item.version === version);
        if (!selected) return false;
        skills.filter((item) => item.id === id).forEach((item) => { item.active = item === selected; });
        return true;
      }),
    };
    const model: ModelProvider = {
      name: "evaluator",
      generate: vi.fn(async () => ({
        text: "Safety is required and uncertainty is explicit.",
        provider: "test",
        model: "test-model",
      })),
    };
    const registry = new SkillRegistry();
    const manager = new SkillManager(store, registry, model, () => ["web.open", "files.read"]);
    await manager.install({
      id: "research.custom",
      version: "1.0.0",
      description: "Custom research",
      instructions: "Research safely.",
      allowedTools: ["web.open"],
    }, null);

    await expect(manager.activate("research.custom", "1.0.0")).rejects.toThrow(/pass/u);
    const evaluation = await manager.evaluate({
      skillId: "research.custom",
      version: "1.0.0",
      createdBy: null,
      cases: [{
        name: "safe answer",
        prompt: "Explain the result",
        requiredStrings: ["safety", "uncertainty"],
        forbiddenStrings: ["guaranteed"],
      }],
    });
    expect(evaluation.passed).toBe(true);
    await expect(manager.activate("research.custom", "1.0.0")).resolves.toMatchObject({ version: "1.0.0" });
    expect(registry.get("research.custom").version).toBe("1.0.0");
  });

  it("rejects skills that request unavailable tools", async () => {
    const manager = new SkillManager({
      listSkillVersions: vi.fn(async () => []),
      insertSkill: vi.fn(), saveSkillEvaluation: vi.fn(), latestSkillEvaluation: vi.fn(), activateSkill: vi.fn(),
    }, new SkillRegistry(), { name: "test", generate: vi.fn() }, () => ["files.read"]);
    await expect(manager.install({
      id: "unsafe.custom",
      version: "1.0.0",
      description: "Unsafe",
      instructions: "Run anything",
      allowedTools: ["shell.exec"],
    }, null)).rejects.toThrow(/unavailable/u);
  });
});
