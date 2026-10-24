import { describe, expect, it } from "vitest";

import {
  defaultAgentSkillId,
  parseAgentSkill,
  verifyAgentSkillDigest,
} from "../src/skills/agent-skill.js";

describe("open Agent Skills compatibility", () => {
  const source = [
    "---",
    "name: source-review",
    "description: Review sources without overstating certainty",
    "metadata:",
    "  internal: false",
    "---",
    "",
    "# Source review",
    "",
    "Cite evidence and state uncertainty.",
  ].join("\n");

  it("imports the portable SKILL.md subset and pins its exact bytes", () => {
    const skill = parseAgentSkill(source);
    expect(skill).toMatchObject({
      name: "source-review",
      description: "Review sources without overstating certainty",
      instructions: expect.stringContaining("Cite evidence"),
    });
    expect(skill.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(defaultAgentSkillId(skill.name)).toBe("community.source-review");
    expect(() => verifyAgentSkillDigest(skill, skill.sha256)).not.toThrow();
  });

  it("rejects malformed, oversized, or changed skills", () => {
    expect(() => parseAgentSkill("# no frontmatter")).toThrow(/frontmatter/u);
    expect(() => parseAgentSkill(`---\nname: Bad Name\ndescription: ok\n---\nDo it`)).toThrow(/Invalid Agent Skill/u);
    expect(() => parseAgentSkill(`---\nname: safe\ndescription: ok\n---\n${"x".repeat(20_001)}`)).toThrow(/Invalid Agent Skill/u);
    const skill = parseAgentSkill(source);
    expect(() => verifyAgentSkillDigest(skill, `sha256:${"0".repeat(64)}`)).toThrow(/mismatch/u);
    expect(() => verifyAgentSkillDigest(skill, "sha256:bad")).toThrow(/64 lowercase/u);
  });

  it("does not interpret complex YAML values", () => {
    expect(() => parseAgentSkill("---\nname: safe\ndescription: >\n  hidden\n---\nDo it"))
      .toThrow(/plain single-line scalar/u);
  });
});
