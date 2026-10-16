import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
const textFiles = files.filter((file) => /\.(?:ts|js|mjs|json|md|ya?ml|sql|sh|example)$/u.test(file));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/u,
];

for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) throw new Error(`Potential committed secret in ${file}`);
  }
}

const productionCompose = await readFile("compose.production.yml", "utf8");
for (const required of ["read_only: true", "no-new-privileges:true", "cap_drop:", "internal: true"]) {
  if (!productionCompose.includes(required)) throw new Error(`Production hardening is missing: ${required}`);
}
const terminal = await readFile("src/tools/terminal.ts", "utf8");
if (/\bshell\s*:\s*true\b/u.test(terminal)) throw new Error("Restricted terminal must not enable a shell");
const gitignore = await readFile(".gitignore", "utf8");
for (const required of [".env", "*.key", "secrets/"]) {
  if (!gitignore.includes(required)) throw new Error(`.gitignore must cover ${required}`);
}

const browser = await readFile("src/tools/managed-browser.ts", "utf8");
for (const required of ["assertPublicUrl", "serviceWorkers: \"block\"", "acceptDownloads: false", "MAX_ACTIONS = 8"]) {
  if (!browser.includes(required)) throw new Error(`Managed browser hardening is missing: ${required}`);
}
const browserService = productionCompose.match(/\n  browser:\n([\s\S]*?)\n  database:/u)?.[1] ?? "";
if (!browserService || browserService.includes("\n    ports:")) {
  throw new Error("Production browser must exist without a published port");
}
for (const legalFile of [
  "docs/PRIVACY_POLICY_TEMPLATE.md",
  "docs/TERMS_OF_USE_TEMPLATE.md",
  "docs/ACCEPTABLE_USE.md",
  "docs/SECURITY.md",
]) {
  if (!files.includes(legalFile)) throw new Error(`Release document is missing: ${legalFile}`);
}
for (const required of [
  "migrations/016_skills.sql",
  "src/skills/manager.ts",
  "tests/skill-manager.test.ts",
]) {
  if (!files.includes(required)) throw new Error(`Skill lifecycle component is missing: ${required}`);
}
const skillManager = await readFile("src/skills/manager.ts", "utf8");
for (const required of ["latest evaluation", "validateTools", "1 to 5 cases", "without tools"]) {
  if (!skillManager.toLowerCase().includes(required.toLowerCase())) {
    throw new Error(`Skill activation safety check is missing: ${required}`);
  }
}
const subagents = await readFile("src/core/subagents.ts", "utf8");
for (const required of [
  "MAX_SUBAGENTS = 3",
  "maxOutputTokens: 2_048",
  "You have no tools, cannot delegate",
  "Promise.all",
]) {
  if (!subagents.includes(required)) throw new Error(`Subagent boundary is missing: ${required}`);
}
const sandboxServer = await readFile("deploy/sandbox/server.mjs", "utf8");
for (const required of [
  "shell: false",
  "MAX_OUTPUT_BYTES = 100_000",
  "MAX_CONCURRENT = 2",
  "uid: runUid",
  "killUidProcesses(runUid)",
  "timeoutSeconds > 60",
  "Path escapes the user workspace",
]) {
  if (!sandboxServer.includes(required)) throw new Error(`Code sandbox boundary is missing: ${required}`);
}
const sandboxService = productionCompose.match(/\n  sandbox:\n([\s\S]*?)\n  database:/u)?.[1] ?? "";
for (const required of ["network_mode: none", "read_only: true", "pids_limit: 128", "cap_drop:", "cap_add:", "SANDBOX_SOCKET_GID: 2000"]) {
  if (!sandboxService.includes(required)) throw new Error(`Production sandbox hardening is missing: ${required}`);
}
if (["docker.sock", "ports:", "privileged:", "SYS_ADMIN", "NET_ADMIN", "SYS_PTRACE"].some((value) => sandboxService.includes(value))) {
  throw new Error("Production sandbox contains a prohibited privilege or exposure");
}

console.log(`Barlas AI Agent security baseline passed for ${textFiles.length} repository text files.`);
