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

console.log(`Barlas AI Agent security baseline passed for ${textFiles.length} repository text files.`);
