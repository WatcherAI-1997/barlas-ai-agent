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
for (const required of [".env", "deploy/production.env", "deploy/local.env", "*.key", "secrets/"]) {
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
  "migrations/018_projects.sql",
  "migrations/019_project_execution.sql",
  "migrations/020_gateway_tokens.sql",
  "install.sh",
  "scripts/doctor.sh",
  "scripts/dashboard-url.sh",
  "docs/INSTALLATION.md",
  "assets/brand/barlas-ai-agent-logo-original.png",
  "assets/brand/barlas-ai-agent-installer.png",
  "assets/brand/barlas-ai-agent-github-hero.png",
  "src/skills/manager.ts",
  "tests/skill-manager.test.ts",
]) {
  if (!files.includes(required)) throw new Error(`Skill lifecycle component is missing: ${required}`);
}
const installer = await readFile("install.sh", "utf8");
const doctor = await readFile("scripts/doctor.sh", "utf8");
const readme = await readFile("README.md", "utf8");
for (const required of ["barlas-ai-agent-github-hero.png", "Quick install", "Security by design", "All 38", "THINK AHEAD. ACT BEYOND."]) {
  if (!readme.includes(required)) throw new Error(`GitHub product presentation is missing: ${required}`);
}
for (const required of ["set -Eeuo pipefail", "chmod 600", "openssl rand -base64 32", "BARLAS_GATEWAY_TOKEN", "openssl rand -hex 32", "--prepare-only", "scripts/doctor.sh", "scripts/dashboard-url.sh", "barlas-ai-agent-installer.png", "TERM_PROGRAM", "⬤  ⬤", "Barlas", "AI AGENT", "never prints them"]) {
  if (!installer.includes(required)) throw new Error(`Installer safety/usability boundary is missing: ${required}`);
}
for (const required of ["--require-running", "expected 600", "non-symlink", "/ready", "Secret values are never printed"]) {
  if (!doctor.includes(required)) throw new Error(`Doctor safety/usability boundary is missing: ${required}`);
}
const projects = await readFile("src/projects/service.ts", "utf8");
const projectMigration = await readFile("migrations/018_projects.sql", "utf8");
const database = await readFile("src/storage/database.ts", "utf8");
for (const required of ["resourceBelongsToUser", "workspace.readBuffer", "writeUpload", 'createHash("sha256")']) {
  if (!projects.includes(required)) throw new Error(`Project isolation/version boundary is missing: ${required}`);
}
const projectExecutionMigration = await readFile("migrations/019_project_execution.sql", "utf8");
for (const required of ["foreign key (project_id, user_id)", "project_checkpoints_run_idx", "where agent_run_id is not null", "unique (project_id, position)"]) {
  if (!projectExecutionMigration.includes(required)) throw new Error(`Project execution boundary is missing: ${required}`);
}
for (const required of ["recordRunResult", 'run.status === "waiting_approval"', "projectIdsForResource"]) {
  if (!projects.includes(required)) throw new Error(`Automatic checkpoint boundary is missing: ${required}`);
}
if (!database.includes("pg_advisory_xact_lock")) throw new Error("Project artifact version allocation is not serialized");
const gatewayTokenMigration = await readFile("migrations/020_gateway_tokens.sql", "utf8");
for (const required of ["delete from user_sessions", "drop column password_hash", "drop column password_salt", "drop table if exists password_reset_codes"]) {
  if (!gatewayTokenMigration.toLowerCase().includes(required)) throw new Error(`Gateway-token migration boundary is missing: ${required}`);
}
if (installer.includes("OWNER_PASSWORD")) throw new Error("Installer must not request or persist an owner password");
for (const required of ["unique (project_id, path, version)", "foreign key (project_id, user_id)", "size_bytes integer"]) {
  if (!projectMigration.includes(required)) throw new Error(`Project artifact database boundary is missing: ${required}`);
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
const builtins = await readFile("src/tools/builtins.ts", "utf8");
for (const toolName of [
  "github.branch.create",
  "github.file.commit",
  "github.pull_request.create",
  "github.issue.create",
  "google_drive.file.create",
  "google_drive.file.update",
  "gmail.draft.create",
  "gmail.send",
  "google_calendar.event.create",
  "google_calendar.event.update",
  "mcp.tool.call",
  "media.image.analyze",
  "media.pdf.analyze",
  "media.audio.transcribe",
  "media.speech.create",
]) {
  const offset = builtins.indexOf(`name: "${toolName}"`);
  const block = builtins.slice(offset, offset + 500);
  if (offset < 0 || !block.includes('risk: "external"')) throw new Error(`External mutation is not approval-gated: ${toolName}`);
}
for (const toolName of [
  "projects.goal.create",
  "projects.goal.update",
  "projects.step.create",
  "projects.step.update",
  "projects.checkpoint.create",
  "projects.artifact.snapshot",
  "projects.artifact.restore",
]) {
  const offset = builtins.indexOf(`name: "${toolName}"`);
  const block = builtins.slice(offset, offset + 500);
  if (offset < 0 || !block.includes('risk: "write"')) throw new Error(`Project mutation is not approval-gated: ${toolName}`);
}
const projectReadOffset = builtins.indexOf('name: "projects.get"');
if (projectReadOffset < 0 || !builtins.slice(projectReadOffset, projectReadOffset + 500).includes('risk: "read"')) {
  throw new Error("Project read tool must remain read-only");
}
const mediaTools = await readFile("src/tools/media.ts", "utf8");
for (const required of ["MAX_MEDIA_BYTES = 10_000_000", "detectMedia", "File extension does not match", "Unsupported or unrecognized", "workspace.readBuffer", "workspace.writeBuffer"]) {
  if (!mediaTools.includes(required)) throw new Error(`Media boundary is missing: ${required}`);
}
const fileWorkspace = await readFile("src/tools/file-workspace.ts", "utf8");
const appSource = await readFile("src/app.ts", "utf8");
const webApp = await readFile("web/app.js", "utf8");
const webIndex = await readFile("web/index.html", "utf8");
const webStyles = await readFile("web/styles.css", "utf8");
for (const required of ["writeUpload", "writeUploadStream", "streamForRead", "constants.O_EXCL", "constants.O_NOFOLLOW", "handle.sync", "DEFAULT_MAX_WORKSPACE_FILE_BYTES", "MAX_DOCUMENT_BYTES"]) {
  if (!fileWorkspace.includes(required)) throw new Error(`Workspace upload boundary is missing: ${required}`);
}
for (const required of ["application/octet-stream", "Content-Disposition", "explicit overwrite is required"]) {
  if (!appSource.includes(required)) throw new Error(`Workspace download/upload boundary is missing: ${required}`);
}
for (const required of ['app.get("/v1/metrics"', "requireOwner(request)", "renderPrometheusMetrics"]) {
  if (!appSource.includes(required)) throw new Error(`Protected operations metrics boundary is missing: ${required}`);
}
const operationsMetrics = await readFile("src/operations/metrics.ts", "utf8");
if (operationsMetrics.includes("userId") || operationsMetrics.includes("email")) {
  throw new Error("Operations metrics must not contain user-identifying labels");
}
for (const prohibited of ["/auth/login", "password-reset"]) {
  if (appSource.includes(prohibited)) throw new Error(`Legacy password authentication route remains: ${prohibited}`);
}
for (const required of ["location.hash.slice(1)", "sessionStorage.setItem(\"barlasToken\"", "history.replaceState", "headers.authorization = `Bearer ${state.token}`"]) {
  if (!webApp.includes(required)) throw new Error(`Gateway-token browser bootstrap is missing: ${required}`);
}
for (const required of ['aria-live="polite"', 'id="detail-dialog"', 'aria-controls="primary-nav"']) {
  if (!webIndex.includes(required)) throw new Error(`Accessible web shell is missing: ${required}`);
}
for (const required of ["prefers-reduced-motion", "button:focus-visible", ".nav-backdrop"]) {
  if (!webStyles.includes(required)) throw new Error(`Responsive web boundary is missing: ${required}`);
}
if (webApp.includes("alert(")) throw new Error("Web interface must use non-blocking notifications or accessible dialogs");
const evaluationRunner = await readFile("scripts/run-agent-evals.mjs", "utf8");
if (evaluationRunner.includes("approved: true")) throw new Error("Agent evaluation must never auto-approve an action");
for (const required of ["approved: false", "parseEvaluationScenarios", "BARLAS_EVAL_TOKEN"]) {
  if (!evaluationRunner.includes(required)) throw new Error(`Agent evaluation safety boundary is missing: ${required}`);
}
const scheduleWorker = await readFile("src/schedules/worker.ts", "utf8");
for (const required of ["scheduleId: schedule.id", "scheduleOccurrence: occurrence", "governance?.consume", "Telegram account is not linked", "Math.max(occurrence.getTime(), Date.now())"]) {
  if (!scheduleWorker.includes(required)) throw new Error(`Schedule safety boundary is missing: ${required}`);
}
const telegramClient = await readFile("src/channels/telegram.ts", "utf8");
const telegramVoice = await readFile("src/channels/telegram-voice.ts", "utf8");
const telegramPolling = await readFile("src/channels/telegram-polling.ts", "utf8");
for (const required of ["sendVoice", "FormData", "TELEGRAM_PUBLIC_UPLOAD_BYTES = 50_000_000", "maxUploadBytes", "parseTelegramVoiceCommand"]) {
  if (!telegramClient.includes(required)) throw new Error(`Telegram voice boundary is missing: ${required}`);
}
for (const required of ["MAX_SPEECH_TEXT = 4_096", "workspace.readBuffer", "telegram/voice/"]) {
  if (!telegramVoice.includes(required)) throw new Error(`Telegram voice workspace boundary is missing: ${required}`);
}
for (const prohibited of ["phone.requestCall", "MTProto", "userbot"]) {
  if (telegramClient.includes(prohibited) || telegramVoice.includes(prohibited)) {
    throw new Error(`Unsupported Telegram account-call mechanism is present: ${prohibited}`);
  }
}
for (const required of ["deleteWebhook", "getUpdates", "update.update_id + 1", "await this.deliver(update)"]) {
  if (!telegramPolling.includes(required) && !telegramClient.includes(required)) {
    throw new Error(`Telegram local polling boundary is missing: ${required}`);
  }
}
const localCompose = await readFile("compose.local.yml", "utf8");
for (const required of ['127.0.0.1:${BARLAS_HTTP_PORT:-17840}:17840', 'profiles: ["public"]']) {
  if (!localCompose.includes(required)) throw new Error(`Local installation boundary is missing: ${required}`);
}
const mcpConnector = await readFile("src/connectors/mcp.ts", "utf8");
for (const required of ["assertPublicUrl", "publicNetworkFetch", "redirectPolicy: \"same-origin\"", "MAX_RESULT_BYTES = 1_000_000"]) {
  if (!mcpConnector.includes(required)) throw new Error(`MCP boundary is missing: ${required}`);
}

console.log(`Barlas AI Agent security baseline passed for ${textFiles.length} repository text files.`);
