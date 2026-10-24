import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultAgentSkillId,
  inspectAgentSkillPackage,
  parseAgentSkill,
  verifyAgentSkillDigest,
  verifyAgentSkillPackageDigest,
} from "../src/skills/agent-skill.js";

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

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

  it("hashes a complete package, embeds portable references, and excludes code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "barlas-agent-skill-"));
    directories.push(directory);
    await mkdir(join(directory, "references"));
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "SKILL.md"), source);
    await writeFile(join(directory, "references", "policy.md"), "Only report verified facts.\n");
    await writeFile(join(directory, "scripts", "collect.py"), "print('must never run')\n");
    await writeFile(join(directory, "assets", "logo.svg"), "<svg/>\n");

    const inspected = await inspectAgentSkillPackage(directory);
    expect(inspected.packageSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(inspected.importedInstructions).toContain("## Imported reference: references/policy.md");
    expect(inspected.importedInstructions).not.toContain("must never run");
    expect(inspected.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "references/policy.md", category: "reference" }),
      expect.objectContaining({ path: "scripts/collect.py", category: "blocked" }),
      expect.objectContaining({ path: "assets/logo.svg", category: "ignored" }),
    ]));
    expect(inspected.warnings.join(" ")).toMatch(/collect\.py/u);
    expect(() => verifyAgentSkillPackageDigest(inspected, inspected.packageSha256)).not.toThrow();

    await writeFile(join(directory, "references", "policy.md"), "Changed after review.\n");
    const changed = await inspectAgentSkillPackage(directory);
    expect(changed.packageSha256).not.toBe(inspected.packageSha256);
    expect(() => verifyAgentSkillPackageDigest(changed, inspected.packageSha256)).toThrow(/mismatch/u);
  });

  it("keeps explicit SKILL.md inspection backward compatible with the file digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "barlas-agent-skill-file-"));
    directories.push(directory);
    const file = join(directory, "SKILL.md");
    await writeFile(file, source);
    await writeFile(join(directory, "unrelated.txt"), "not part of explicit file inspection");
    const inspected = await inspectAgentSkillPackage(file);
    expect(inspected.packageSha256).toBe(inspected.skill.sha256);
    expect(inspected.files.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  it("rejects malformed UTF-8 in portable references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "barlas-agent-skill-utf8-"));
    directories.push(directory);
    await mkdir(join(directory, "references"));
    await writeFile(join(directory, "SKILL.md"), source);
    await writeFile(join(directory, "references", "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await expect(inspectAgentSkillPackage(directory)).rejects.toThrow(/UTF-8/u);
  });
});
