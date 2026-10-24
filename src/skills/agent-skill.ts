import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

const MAX_AGENT_SKILL_BYTES = 64_000;
const MAX_AGENT_SKILL_PACKAGE_BYTES = 2_000_000;
const MAX_AGENT_SKILL_FILES = 128;
const MAX_IMPORTED_REFERENCE_BYTES = 96_000;
const PORTABLE_REFERENCE_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".yaml", ".yml"]);
const BLOCKED_EXTENSIONS = new Set([".bat", ".cmd", ".com", ".dll", ".dylib", ".exe", ".js", ".mjs", ".cjs", ".ps1", ".py", ".sh", ".so", ".ts", ".wasm"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

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

export type AgentSkillFileCategory = "skill" | "reference" | "blocked" | "ignored";

export interface AgentSkillPackageFile {
  path: string;
  bytes: number;
  category: AgentSkillFileCategory;
  reason?: string;
}

export interface AgentSkillPackageInspection {
  root: string;
  skillFile: string;
  skill: ImportedAgentSkill;
  packageSha256: `sha256:${string}`;
  files: AgentSkillPackageFile[];
  importedInstructions: string;
  warnings: string[];
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index);
}

function packageCategory(path: string): Pick<AgentSkillPackageFile, "category" | "reason"> {
  if (path === "SKILL.md") return { category: "skill" };
  const parts = path.toLowerCase().split("/");
  const suffix = extension(path);
  if (parts.includes("scripts") || parts.includes("hooks") || BLOCKED_EXTENSIONS.has(suffix)) {
    return { category: "blocked", reason: "Executable code and hooks are never imported" };
  }
  if (parts[0] === "references" && PORTABLE_REFERENCE_EXTENSIONS.has(suffix)) {
    return { category: "reference" };
  }
  return { category: "ignored", reason: "Not part of the portable prompt-and-reference subset" };
}

async function packageFiles(root: string): Promise<Array<{ path: string; bytes: Buffer; file: AgentSkillPackageFile }>> {
  const collected: Array<{ path: string; bytes: Buffer; file: AgentSkillPackageFile }> = [];
  let totalBytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        collected.push({ path, bytes: Buffer.alloc(0), file: { path, bytes: 0, category: "blocked", reason: "Symbolic links are never followed" } });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (collected.length >= MAX_AGENT_SKILL_FILES) throw new Error(`Agent Skill package exceeds ${MAX_AGENT_SKILL_FILES} files`);
      const bytes = await readFile(absolute);
      totalBytes += bytes.length;
      if (totalBytes > MAX_AGENT_SKILL_PACKAGE_BYTES) throw new Error("Agent Skill package exceeds 2 MB");
      collected.push({ path, bytes, file: { path, bytes: bytes.length, ...packageCategory(path) } });
    }
  }
  await visit(root);
  return collected.sort((left, right) => left.path.localeCompare(right.path));
}

function packageDigest(files: Array<{ path: string; bytes: Buffer }>): `sha256:${string}` {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(Buffer.from(`${file.path}\0${file.bytes.length}\0`, "utf8"));
    digest.update(file.bytes);
    digest.update(Buffer.from("\0", "utf8"));
  }
  return `sha256:${digest.digest("hex")}`;
}

export async function inspectAgentSkillPackage(sourcePath: string): Promise<AgentSkillPackageInspection> {
  const source = resolve(sourcePath);
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error("Agent Skill source must not be a symbolic link");
  const isDirectory = sourceStat.isDirectory();
  const root = isDirectory ? source : dirname(source);
  const skillFile = isDirectory ? join(root, "SKILL.md") : source;
  if (!isDirectory && basename(source) !== "SKILL.md") throw new Error("Agent Skill file must be named SKILL.md");
  const skillFileStat = await lstat(skillFile);
  if (skillFileStat.isSymbolicLink() || !skillFileStat.isFile()) {
    throw new Error("Agent Skill SKILL.md must be a regular file, not a symbolic link");
  }
  const skill = parseAgentSkill(await readFile(skillFile, "utf8"));
  const packageEntries = isDirectory
    ? await packageFiles(root)
    : [{ path: "SKILL.md", bytes: await readFile(skillFile), file: { path: "SKILL.md", bytes: (await lstat(skillFile)).size, category: "skill" as const } }];
  const references = packageEntries.filter((entry) => entry.file.category === "reference");
  const referenceBytes = references.reduce((sum, entry) => sum + entry.bytes.length, 0);
  if (referenceBytes > MAX_IMPORTED_REFERENCE_BYTES) throw new Error("Portable Agent Skill references exceed 96 KB");
  const sections = references.map((entry) => {
    let content: string;
    try {
      content = UTF8_DECODER.decode(entry.bytes);
    } catch {
      throw new Error(`Agent Skill reference ${entry.path} is not valid UTF-8 text`);
    }
    if (content.includes("\0")) throw new Error(`Agent Skill reference ${entry.path} is not valid portable text`);
    return `## Imported reference: ${entry.path}\n\n${content.trim()}`;
  });
  const importedInstructions = [skill.instructions, ...sections].filter(Boolean).join("\n\n");
  if (importedInstructions.length > 20_000) throw new Error("Imported Agent Skill instructions and references exceed 20,000 characters");
  const blocked = packageEntries.filter((entry) => entry.file.category === "blocked").map((entry) => entry.path);
  const ignored = packageEntries.filter((entry) => entry.file.category === "ignored").map((entry) => entry.path);
  const warnings = [
    blocked.length ? `Executable or linked content excluded (${blocked.join(", ")})` : "",
    ignored.length ? `Non-portable files excluded (${ignored.join(", ")})` : "",
  ].filter(Boolean);
  return {
    root,
    skillFile,
    skill,
    packageSha256: isDirectory ? packageDigest(packageEntries) : skill.sha256,
    files: packageEntries.map((entry) => entry.file),
    importedInstructions,
    warnings,
  };
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

function verifyDigest(receivedDigest: string, trustedDigest: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(trustedDigest)) {
    throw new Error("Use --trust-sha256 sha256:<64 lowercase hex characters>");
  }
  if (receivedDigest !== trustedDigest) {
    throw new Error(`Agent Skill digest mismatch: expected ${trustedDigest}, received ${receivedDigest}`);
  }
}

export function verifyAgentSkillDigest(skill: ImportedAgentSkill, trustedDigest: string): void {
  verifyDigest(skill.sha256, trustedDigest);
}

export function verifyAgentSkillPackageDigest(skillPackage: AgentSkillPackageInspection, trustedDigest: string): void {
  verifyDigest(skillPackage.packageSha256, trustedDigest);
}

export function defaultAgentSkillId(name: string): string {
  const id = `community.${name}`;
  if (id.length > 64) throw new Error("Agent Skill name is too long; provide a shorter --id");
  return id;
}
