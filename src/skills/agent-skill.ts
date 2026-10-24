import { createHash } from "node:crypto";

import { z } from "zod";

const MAX_AGENT_SKILL_BYTES = 64_000;

const agentSkillSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
}).strict();

export interface ImportedAgentSkill {
  name: string;
  description: string;
  instructions: string;
  sha256: `sha256:${string}`;
}

function scalar(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Agent Skill ${field} must not be empty`);
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== "string") throw new Error();
      return parsed;
    } catch {
      throw new Error(`Agent Skill ${field} has an invalid quoted value`);
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new Error(`Agent Skill ${field} has an invalid quoted value`);
    }
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (/[\[\]{}&*!|>]/u.test(trimmed)) {
    throw new Error(`Agent Skill ${field} must be a plain single-line scalar`);
  }
  return trimmed.replace(/\s+#.*$/u, "").trim();
}

export function parseAgentSkill(raw: string): ImportedAgentSkill {
  if (Buffer.byteLength(raw, "utf8") > MAX_AGENT_SKILL_BYTES) {
    throw new Error("Agent Skill exceeds 64 KB");
  }
  const normalized = raw.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) throw new Error("Agent Skill must start with YAML frontmatter");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("Agent Skill frontmatter is not closed");
  const frontmatter = normalized.slice(4, end);
  const values = new Map<string, string>();
  for (const line of frontmatter.split("\n")) {
    if (!line.trim() || /^\s*#/u.test(line) || /^\s/u.test(line)) continue;
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/u.exec(line);
    if (match && ["name", "description"].includes(match[1]!)) {
      values.set(match[1]!, scalar(match[2]!, match[1]!));
    }
  }
  const parsed = agentSkillSchema.safeParse({
    name: values.get("name"),
    description: values.get("description"),
    instructions: normalized.slice(end + 5).trim(),
  });
  if (!parsed.success) throw new Error(`Invalid Agent Skill: ${z.prettifyError(parsed.error)}`);
  return {
    ...parsed.data,
    sha256: `sha256:${createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex")}`,
  };
}

export function verifyAgentSkillDigest(skill: ImportedAgentSkill, trustedDigest: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(trustedDigest)) {
    throw new Error("Use --trust-sha256 sha256:<64 lowercase hex characters>");
  }
  if (skill.sha256 !== trustedDigest) {
    throw new Error(`Agent Skill digest mismatch: expected ${trustedDigest}, received ${skill.sha256}`);
  }
}

export function defaultAgentSkillId(name: string): string {
  const id = `community.${name}`;
  if (id.length > 64) throw new Error("Agent Skill name is too long; provide a shorter --id");
  return id;
}
