#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  createStateBackup,
  defaultBackupName,
  defaultStateDirectory,
  restoreStateBackup,
  verifyStateBackup,
} from "./system/backup.js";

import {
  createSignedSkillPackage,
  parseSignedSkillPackage,
  parseSkillPackageTemplate,
  skillEvaluationCasesSchema,
  skillPublisherFingerprint,
  verifySkillPackage,
} from "./skills/package.js";
import {
  availableCatalogEntries,
  createSignedSkillCatalog,
  fetchCatalogPackage,
  parseSignedSkillCatalog,
  parseSkillCatalogTemplate,
  selectCatalogEntry,
  verifySkillCatalog,
} from "./skills/catalog.js";
import {
  defaultAgentSkillId,
  parseAgentSkill,
  verifyAgentSkillDigest,
} from "./skills/agent-skill.js";

type JsonObject = Record<string, unknown>;

export class BarlasApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.text();
    const parsed = body ? JSON.parse(body) as unknown : undefined;
    if (!response.ok) {
      const message = typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return parsed as T;
  }
}

function value(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function renderRows(rows: JsonObject[], fields: string[]): string {
  if (rows.length === 0) return "Нет данных.";
  const widths = fields.map((field) => Math.min(50, Math.max(
    field.length,
    ...rows.map((row) => value(row[field]).length),
  )));
  const line = (row: JsonObject) => fields.map((field, index) => (
    value(row[field]).slice(0, widths[index]!).padEnd(widths[index]!)
  )).join("  ");
  return [line(Object.fromEntries(fields.map((field) => [field, field]))), ...rows.map(line)].join("\n");
}

interface CliContext {
  api: BarlasApiClient;
  userId: string;
  baseUrl: string;
}

async function context(): Promise<CliContext> {
  const url = process.env.BARLAS_URL ?? "http://127.0.0.1:17840";
  const token = process.env.BARLAS_TOKEN ?? process.env.BARLAS_GATEWAY_TOKEN ?? process.env.BARLAS_API_TOKEN;
  if (!token) throw new Error("BARLAS_TOKEN or a protected Barlas service token is required");
  const api = new BarlasApiClient(url, token);
  const me = await api.request<{ principal: { id: string } }>("/v1/me");
  return { api, userId: me.principal.id, baseUrl: url };
}

async function status(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ status: string; uptimeSeconds: number; workerEnabled: boolean; stats: JsonObject }>(
    `/v1/dashboard?userId=${encodeURIComponent(ctx.userId)}`,
  );
  output.write([
    `Статус: ${result.status}`,
    `Uptime: ${result.uptimeSeconds}s`,
    `Worker: ${result.workerEnabled ? "включён" : "выключен"}`,
    ...Object.entries(result.stats).map(([key, item]) => `${key}: ${value(item)}`),
  ].join("\n") + "\n");
}

async function list(ctx: CliContext, resource: "agent-runs" | "approvals" | "jobs" | "projects" | "schedules"): Promise<void> {
  const result = await ctx.api.request<Record<string, JsonObject[]>>(
    `/v1/${resource}?userId=${encodeURIComponent(ctx.userId)}&limit=25`,
  );
  const rows = Object.values(result).find(Array.isArray) ?? [];
  const fields = resource === "approvals" ? ["id", "toolName", "risk", "status", "summary"]
    : resource === "projects" ? ["id", "name", "status", "updatedAt"]
      : resource === "jobs" ? ["id", "jobType", "status", "scheduledFor", "error"]
        : resource === "schedules" ? ["id", "name", "status", "cronExpression", "timezone"]
          : ["id", "status", "taskClass", "updatedAt", "error"];
  output.write(`${renderRows(rows, fields)}\n`);
}

async function extensions(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ extensions: JsonObject[] }>("/v1/extensions");
  output.write(`${renderRows(result.extensions, ["id", "kind", "configured", "capabilities"])}\n`);
}

async function nodes(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ nodes: JsonObject[] }>(`/v1/nodes?userId=${encodeURIComponent(ctx.userId)}`);
  output.write(`${renderRows(result.nodes, ["id", "name", "platform", "capabilities", "lastSeenAt", "revokedAt"])}\n`);
}

async function extensionsCatalog(ctx: CliContext, kind?: string): Promise<void> {
  const result = await ctx.api.request<{ extensions: JsonObject[] }>("/v1/extensions");
  const rows = kind ? result.extensions.filter((item) => value(item.kind) === kind) : result.extensions;
  output.write(`${renderRows(rows, ["id", "kind", "configured", "capabilities"])}\n`);
}

async function readTextSource(source: string, maxBytes: number): Promise<string> {
  if (!source) throw new Error("Укажите HTTPS URL или путь к файлу каталога");
  if (!/^https?:/iu.test(source)) {
    const raw = await readFile(resolve(source), "utf8");
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("Файл превышает допустимый размер");
    return raw;
  }
  const url = new URL(source);
  if (url.protocol !== "https:") throw new Error("Удалённый каталог должен использовать HTTPS");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Не удалось скачать каталог: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Каталог превышает допустимый размер");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Каталог превышает допустимый размер");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString("utf8");
}

async function loadTrustedCatalog(source: string, fingerprint: string) {
  if (!fingerprint) throw new Error("Сверьте ключ каталога и укажите --trust-catalog sha256:<отпечаток>");
  const catalog = parseSignedSkillCatalog(await readTextSource(source, 1_000_000));
  const statePath = process.env.BARLAS_STATE_DIR
    ? join(process.env.BARLAS_STATE_DIR, "skill-catalog-sequences.json")
    : process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Barlas", "data", "skill-catalog-sequences.json")
      : join(homedir(), ".barlas", "skill-catalog-sequences.json");
  let state: Record<string, number> = {};
  try {
    const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) state = value as Record<string, number>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("Не удалось прочитать состояние каталога");
  }
  const minimumSequence = Number.isSafeInteger(state[fingerprint.toLowerCase()]) ? state[fingerprint.toLowerCase()]! : 0;
  verifySkillCatalog(catalog, fingerprint, new Date(), minimumSequence);
  if (catalog.sequence > minimumSequence) {
    state[catalog.signer.fingerprint] = catalog.sequence;
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return catalog;
}

async function verifyCatalogFile(source: string, fingerprint: string): Promise<void> {
  const skillCatalog = await loadTrustedCatalog(source, fingerprint);
  output.write([
    `Каталог проверен: ${skillCatalog.name}`,
    `Подписант: ${skillCatalog.signer.name}`,
    `Отпечаток: ${skillCatalog.signer.fingerprint}`,
    `Последовательность: ${skillCatalog.sequence}`,
    `Действует до: ${skillCatalog.expiresAt}`,
    `Доступно пакетов: ${availableCatalogEntries(skillCatalog).length}`,
    `Отозвано записей: ${skillCatalog.revocations.length}`,
  ].join("\n") + "\n");
}

async function listSkillCatalog(source: string, fingerprint: string, query = ""): Promise<void> {
  const skillCatalog = await loadTrustedCatalog(source, fingerprint);
  const normalized = query.toLocaleLowerCase();
  const rows = availableCatalogEntries(skillCatalog)
    .filter((entry) => !normalized || `${entry.skillId} ${entry.description}`.toLocaleLowerCase().includes(normalized));
  output.write(`${renderRows(rows as unknown as JsonObject[], ["skillId", "version", "description", "publisherFingerprint"])}\n`);
}

async function signSkillCatalogFile(templatePath: string, keyPath: string, outputPath: string, signerName: string): Promise<void> {
  if (!templatePath || !keyPath || !outputPath || !signerName) {
    throw new Error("Использование: skills catalog sign TEMPLATE PRIVATE_KEY OUTPUT --name NAME");
  }
  const template = parseSkillCatalogTemplate(await readFile(resolve(templatePath), "utf8"));
  const privateKey = await readFile(resolve(keyPath), "utf8");
  const skillCatalog = createSignedSkillCatalog(template, signerName, privateKey);
  await writeFile(resolve(outputPath), `${JSON.stringify(skillCatalog, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
  output.write(`Каталог подписан: ${skillCatalog.name}, sequence ${skillCatalog.sequence}\nОтпечаток: ${skillCatalog.signer.fingerprint}\n`);
}

async function installSkillFromCatalog(
  ctx: CliContext,
  source: string,
  id: string,
  version: string | undefined,
  catalogFingerprint: string,
  publisherFingerprint: string,
): Promise<void> {
  if (!id) throw new Error("Укажите ID навыка из каталога");
  const skillCatalog = await loadTrustedCatalog(source, catalogFingerprint);
  const entry = selectCatalogEntry(skillCatalog, id, version);
  if (!publisherFingerprint) {
    throw new Error(`Сверьте издателя и повторите с --trust-publisher ${entry.publisherFingerprint}`);
  }
  if (publisherFingerprint.toLowerCase() !== entry.publisherFingerprint) throw new Error("Отпечаток издателя не совпадает с каталогом");
  const skillPackage = await fetchCatalogPackage(entry);
  const { skill } = await ctx.api.request<{ skill: JsonObject }>("/v1/skills/packages", {
    method: "POST",
    body: JSON.stringify({ package: skillPackage, trustedFingerprint: entry.publisherFingerprint }),
  });
  output.write(`Установлен кандидат ${value(skill.id)}@${value(skill.version)} из ${skillCatalog.name} (не активен).\n`);
  if (!skillPackage.evaluation) {
    output.write("В пакете нет evaluation-кейсов; активация заблокирована до отдельной проверки.\n");
    return;
  }
  const evaluated = await ctx.api.request<{ evaluation: JsonObject }>(
    `/v1/skills/${encodeURIComponent(entry.skillId)}/${encodeURIComponent(entry.version)}/evaluate`,
    { method: "POST", body: JSON.stringify(skillPackage.evaluation) },
  );
  if (evaluated.evaluation.passed !== true) {
    output.write(`Evaluation не пройден (${value(evaluated.evaluation.passedCases)}/${value(evaluated.evaluation.totalCases)}); навык не активирован.\n`);
    return;
  }
  await activateSkill(ctx, entry.skillId, entry.version);
}

async function skills(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ skills: JsonObject[] }>("/v1/skills");
  output.write(`${renderRows(result.skills, ["id", "version", "name", "active", "allowedTools"])}\n`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readAgentSkill(path: string) {
  if (!path) throw new Error("Укажите путь к SKILL.md или каталогу навыка");
  const source = resolve(path);
  const file = (await stat(source)).isDirectory() ? join(source, "SKILL.md") : source;
  return { file, skill: parseAgentSkill(await readFile(file, "utf8")) };
}

async function inspectAgentSkill(path: string): Promise<void> {
  const { file, skill } = await readAgentSkill(path);
  output.write([
    `Agent Skill: ${skill.name}`,
    `Описание: ${skill.description}`,
    `Файл: ${file}`,
    `SHA-256: ${skill.sha256}`,
    "Импорт ничего не исполняет. Изучите SKILL.md, затем повторите digest через skills import-agent --trust-sha256.",
  ].join("\n") + "\n");
}

async function importAgentSkill(ctx: CliContext, args: string[]): Promise<void> {
  const { skill } = await readAgentSkill(args[2] ?? "");
  const trustedDigest = option(args, "--trust-sha256") ?? "";
  verifyAgentSkillDigest(skill, trustedDigest);
  const id = option(args, "--id") ?? defaultAgentSkillId(skill.name);
  const version = option(args, "--version") ?? "1.0.0";
  const allowedTools = (option(args, "--allow-tools") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const { skill: installed } = await ctx.api.request<{ skill: JsonObject }>("/v1/skills", {
    method: "POST",
    body: JSON.stringify({
      id, version, description: skill.description, instructions: skill.instructions, allowedTools,
      provenance: { format: "agentskills.io", sha256: skill.sha256 },
    }),
  });
  output.write([
    `Импортирован неактивный кандидат ${value(installed.id)}@${value(installed.version)}.`,
    `Источник agentskills.io/skills.sh: ${skill.sha256}.`,
    `Разрешённые инструменты: ${allowedTools.join(", ") || "нет"}.`,
    "Перед активацией создайте acceptance cases и выполните skills evaluate.",
  ].join("\n") + "\n");
}

async function readHiddenSecret(prompt: string): Promise<string> {
  const fromEnvironment = process.env.BARLAS_CONNECTOR_SECRET;
  if (fromEnvironment) {
    delete process.env.BARLAS_CONNECTOR_SECRET;
    return fromEnvironment;
  }
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Запустите в интерактивном терминале или передайте секрет через BARLAS_CONNECTOR_SECRET");
  }
  output.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let secret = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("Отменено")); return; }
        if (key.name === "return" || key.name === "enter") { cleanup(); output.write("\n"); resolve(secret); return; }
        if (key.name === "backspace") {
          if (secret) { secret = secret.slice(0, -1); output.write("\b \b"); }
          return;
        }
        if (character && !key.ctrl && !/[\r\n]/u.test(character)) { secret += character; output.write("*"); }
      };
      const cleanup = () => process.stdin.off("keypress", onKeypress);
      process.stdin.on("keypress", onKeypress);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function verifySkillPackageFile(path: string): Promise<void> {
  if (!path) throw new Error("Укажите путь к подписанному JSON-пакету навыка");
  const skillPackage = parseSignedSkillPackage(await readFile(resolve(path), "utf8"));
  const fingerprint = verifySkillPackage(skillPackage);
  output.write([
    `Подпись верна: ${skillPackage.skill.id}@${skillPackage.skill.version}`,
    `Издатель: ${skillPackage.publisher.name}`,
    `Отпечаток: ${fingerprint}`,
    "Перед установкой сверьте отпечаток с независимым источником издателя.",
  ].join("\n") + "\n");
}

async function createSkillSigningKey(prefix: string): Promise<void> {
  if (!prefix) throw new Error("Укажите префикс файлов ключа");
  const privatePath = resolve(`${prefix}.private.pem`);
  const publicPath = resolve(`${prefix}.public.pem`);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(privatePath, privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await writeFile(publicPath, publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
  } catch (error) {
    // Keep the private key safe and surface the collision instead of overwriting either file.
    throw error;
  }
  output.write(`Ключ создан: ${privatePath}\nПубличный ключ: ${publicPath}\nОтпечаток: ${skillPublisherFingerprint(publicKey)}\n`);
}

async function signSkillPackageFile(templatePath: string, keyPath: string, outputPath: string): Promise<void> {
  if (!templatePath || !keyPath || !outputPath) throw new Error("Использование: skills sign TEMPLATE PRIVATE_KEY OUTPUT");
  const template = parseSkillPackageTemplate(await readFile(resolve(templatePath), "utf8"));
  const privateKey = await readFile(resolve(keyPath), "utf8");
  const skillPackage = createSignedSkillPackage(template, privateKey);
  await writeFile(resolve(outputPath), `${JSON.stringify(skillPackage, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
  output.write(`Подписан ${skillPackage.skill.id}@${skillPackage.skill.version}\nОтпечаток: ${skillPackage.publisher.fingerprint}\n`);
}

async function installSkillPackage(ctx: CliContext, path: string, trustedFingerprint: string): Promise<void> {
  if (!path) throw new Error("Укажите путь к JSON-пакету навыка");
  if (!trustedFingerprint) throw new Error("Сначала сверьте издателя, затем укажите --trust sha256:<отпечаток>");
  const packagePath = resolve(path);
  const skillPackage = parseSignedSkillPackage(await readFile(packagePath, "utf8"));
  const fingerprint = verifySkillPackage(skillPackage, trustedFingerprint);
  const { skill } = await ctx.api.request<{ skill: JsonObject }>("/v1/skills/packages", {
    method: "POST",
    body: JSON.stringify({ package: skillPackage, trustedFingerprint: fingerprint }),
  });
  output.write(`Установлен кандидат ${value(skill.id)}@${value(skill.version)} (не активен).\n`);
  if (!skillPackage.evaluation) {
    output.write("В пакете нет evaluation-кейсов. Добавьте их и выполните skills evaluate перед активацией.\n");
    return;
  }
  const id = skillPackage.skill.id;
  const version = skillPackage.skill.version;
  const evaluated = await ctx.api.request<{ evaluation: JsonObject }>(
    `/v1/skills/${encodeURIComponent(id)}/${encodeURIComponent(version)}/evaluate`,
    { method: "POST", body: JSON.stringify(skillPackage.evaluation) },
  );
  const passed = evaluated.evaluation.passed === true;
  output.write(`Evaluation: ${passed ? "пройден" : "не пройден"} (${value(evaluated.evaluation.passedCases)}/${value(evaluated.evaluation.totalCases)}).\n`);
  if (!passed) {
    output.write("Навык оставлен неактивным. Исправьте пакет и выпустите новую версию.\n");
    return;
  }
  await activateSkill(ctx, id, version);
}

async function evaluateSkill(ctx: CliContext, id: string, version: string, path: string): Promise<void> {
  if (!id || !version || !path) throw new Error("Использование: skills evaluate ID VERSION cases.json");
  const raw = await readFile(resolve(path), "utf8");
  if (Buffer.byteLength(raw, "utf8") > 128_000) throw new Error("Evaluation file exceeds 128 KB");
  let valueFromFile: unknown;
  try { valueFromFile = JSON.parse(raw) as unknown; } catch { throw new Error("Evaluation file is not valid JSON"); }
  const source = typeof valueFromFile === "object" && valueFromFile !== null && "evaluation" in valueFromFile
    ? (valueFromFile as { evaluation: unknown }).evaluation
    : valueFromFile;
  const parsed = skillEvaluationCasesSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid evaluation cases: ${z.prettifyError(parsed.error)}`);
  const result = await ctx.api.request<{ evaluation: JsonObject }>(
    `/v1/skills/${encodeURIComponent(id)}/${encodeURIComponent(version)}/evaluate`,
    { method: "POST", body: JSON.stringify(parsed.data) },
  );
  output.write(`${JSON.stringify(result.evaluation, null, 2)}\n`);
}

async function activateSkill(ctx: CliContext, id: string, version: string): Promise<void> {
  if (!id || !version) throw new Error("Использование: skills activate ID VERSION");
  const result = await ctx.api.request<{ skill: JsonObject }>(
    `/v1/skills/${encodeURIComponent(id)}/${encodeURIComponent(version)}/activate`,
    { method: "POST" },
  );
  output.write(`Активен ${value(result.skill.id)}@${value(result.skill.version)}.\n`);
}

async function tools(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ tools: JsonObject[] }>("/v1/tools");
  output.write(`${renderRows(result.tools, ["name", "risk", "description"])}\n`);
}

async function sessions(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ conversations: JsonObject[] }>(
    `/v1/conversations?userId=${encodeURIComponent(ctx.userId)}&limit=25`,
  );
  output.write(`${renderRows(result.conversations, ["id", "title", "updatedAt", "createdAt"])}\n`);
}

async function memorySearch(ctx: CliContext, query: string): Promise<void> {
  if (!query) throw new Error("Укажите поисковый запрос");
  const result = await ctx.api.request<{ memories: JsonObject[] }>(
    `/v1/memory/search?userId=${encodeURIComponent(ctx.userId)}&query=${encodeURIComponent(query)}&limit=20`,
  );
  output.write(`${renderRows(result.memories, ["id", "kind", "content", "createdAt"])}\n`);
}

async function audit(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ traces: JsonObject[] }>(
    `/v1/traces?userId=${encodeURIComponent(ctx.userId)}&limit=25`,
  );
  output.write(`${renderRows(result.traces, ["traceId", "operation", "status", "createdAt"])}\n`);
}

async function doctor(ctx: CliContext): Promise<void> {
  const [health, ready, control] = await Promise.all([
    ctx.api.request<{ status: string }>("/health"),
    ctx.api.request<{ status: string }>("/ready"),
    ctx.api.request<{ paused: boolean }>("/v1/system/control"),
  ]);
  output.write(`API: ${health.status}\nRuntime: ${ready.status}${control.paused ? " (paused)" : ""}\nGateway: authenticated\nURL: ${ctx.baseUrl}\n`);
}

async function runtimeControl(ctx: CliContext, actionName: "status" | "pause" | "resume", reason = ""): Promise<void> {
  const path = actionName === "status" ? "/v1/system/control" : `/v1/system/${actionName}`;
  const state = await ctx.api.request<{ paused: boolean; reason?: string; changedAt?: string }>(path, actionName === "status" ? {} : {
    method: "POST",
    body: JSON.stringify(actionName === "pause" ? { reason: reason || "Paused by owner" } : {}),
  });
  output.write(`Runtime: ${state.paused ? "paused" : "active"}${state.reason ? `\nReason: ${state.reason}` : ""}${state.changedAt ? `\nChanged: ${state.changedAt}` : ""}\n`);
}

const completionCommands = [
  "agent", "agents", "approvals", "approve", "audit", "backup", "channels", "chat", "completion", "council",
  "config", "configure", "cron", "daemon", "dashboard", "desktop", "devices", "doctor", "extensions", "gateway",
  "health", "integrations", "jobs", "logs", "memory", "models", "node", "nodes", "onboard", "pause",
  "plugins", "projects", "reject", "repair", "resume", "runs", "schedules", "security", "sessions",
  "skills", "status", "system", "tasks", "terminal", "tools", "transcripts", "tui", "uninstall", "update", "voice",
];

export function generateShellCompletion(shell: string): string {
  const words = completionCommands.join(" ");
  if (shell === "bash") return `complete -W '${words}' barlas\n`;
  if (shell === "zsh") return `#compdef barlas\n_arguments '1:command:(${words})'\n`;
  if (shell === "fish") return completionCommands.map((command) => `complete -c barlas -f -a '${command}'`).join("\n") + "\n";
  if (["powershell", "pwsh"].includes(shell)) return `Register-ArgumentCompleter -Native -CommandName barlas -ScriptBlock { param($wordToComplete) '${words}'.Split(' ') | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object { [Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }\n`;
  throw new Error("Shell must be bash, zsh, fish, or powershell");
}

async function backupCommand(args: string[]): Promise<void> {
  const actionName = args[1] ?? "create";
  const archive = args[2] && !args[2]!.startsWith("--") ? args[2]! : defaultBackupName();
  const source = option(args, "--source") ?? defaultStateDirectory();
  const target = option(args, "--target") ?? defaultStateDirectory();
  const summary = actionName === "create" ? await createStateBackup(source, archive)
    : actionName === "verify" ? await verifyStateBackup(archive)
      : actionName === "restore" ? await restoreStateBackup(archive, target, args.includes("--force"))
        : (() => { throw new Error("Backup action must be create, verify, or restore"); })();
  output.write(`Backup ${actionName}: ${summary.archive}\nFiles: ${summary.files}\nBytes: ${summary.bytes}\nCreated: ${summary.createdAt}\n`);
}

async function action(ctx: CliContext, resource: "agent-runs" | "jobs" | "schedules", id: string, verb: string): Promise<void> {
  if (!id) throw new Error("Укажите ID");
  const result = await ctx.api.request<JsonObject>(`/v1/${resource}/${encodeURIComponent(id)}/${verb}`, {
    method: "POST", body: JSON.stringify({ userId: ctx.userId }),
  });
  output.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function nodePairingCode(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ code: string; expiresAt: string }>("/v1/nodes/pairing-code", {
    method: "POST", body: JSON.stringify({ userId: ctx.userId }),
  });
  output.write(`Одноразовый код: ${result.code}\nДействует до: ${result.expiresAt}\n`);
}

async function decide(ctx: CliContext, id: string, approved: boolean): Promise<void> {
  const result = await ctx.api.request<JsonObject>(`/v1/approvals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ userId: ctx.userId, approved }),
  });
  output.write(`${approved ? "Разрешено" : "Отклонено"}: ${id}\n${JSON.stringify(result, null, 2)}\n`);
}

async function ask(ctx: CliContext, prompt: string, conversationId?: string, agentId?: string): Promise<string | undefined> {
  const accepted = await ctx.api.request<{
    runId?: string;
    conversationId?: string;
    message?: { content?: string };
    status?: string;
  }>("/v1/agent/run", {
    method: "POST",
    body: JSON.stringify({
      userId: ctx.userId,
      ...(conversationId ? { conversationId } : {}),
      ...(agentId ? { agentId } : {}),
      messages: [{ role: "user", content: prompt }],
      ...(!agentId ? { taskClass: "fast" } : {}),
      maxSteps: 8,
    }),
  });
  if (!accepted.runId) {
    output.write(`${accepted.message?.content ?? JSON.stringify(accepted)}\n`);
    return accepted.conversationId ?? conversationId;
  }
  output.write(`Запуск ${accepted.runId.slice(0, 8)}…\n`);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const response = await ctx.api.request<{ run: JsonObject }>(
      `/v1/agent-runs/${accepted.runId}?userId=${encodeURIComponent(ctx.userId)}`,
    );
    const runStatus = value(response.run.status);
    if (["queued", "running"].includes(runStatus)) continue;
    if (runStatus === "waiting_approval") {
      output.write(`Ожидается подтверждение: ${value(response.run.pendingApprovalId)}\n`);
      return accepted.conversationId ?? conversationId;
    }
    const result = response.run.result as { text?: string } | undefined;
    if (result?.text) output.write(`${result.text}\n`);
    else if (response.run.error) output.write(`Ошибка: ${value(response.run.error)}\n`);
    else output.write(`${JSON.stringify(response.run, null, 2)}\n`);
    return value(response.run.conversationId) !== "-"
      ? value(response.run.conversationId)
      : accepted.conversationId ?? conversationId;
  }
}

async function agents(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ profiles: JsonObject[] }>(`/v1/agents?userId=${encodeURIComponent(ctx.userId)}`);
  output.write(`${renderRows(result.profiles, ["id", "slug", "name", "style", "defaultTaskClass", "projectId"])}\n`);
}

async function council(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{
    chief: JsonObject;
    members: JsonObject[];
  }>("/v1/agents/council");
  output.write(`Глава: ${value(result.chief.name)}\n${value(result.chief.mandate)}\n\n`);
  output.write(`${renderRows(result.members, ["id", "name", "taskClass", "character", "mandate"])}\n`);
}

async function createAgentProfile(ctx: CliContext, args: string[]): Promise<void> {
  const slug = args[2] ?? "";
  const name = args[3] ?? "";
  if (!slug || !name) throw new Error("Использование: agents create SLUG NAME [--style STYLE] [--task CLASS] [--project ID] [--instructions TEXT]");
  const result = await ctx.api.request<{ profile: JsonObject }>("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      userId: ctx.userId,
      slug,
      name,
      style: option(args, "--style") ?? "balanced",
      defaultTaskClass: option(args, "--task") ?? "fast",
      ...(option(args, "--project") ? { projectId: option(args, "--project") } : {}),
      instructions: option(args, "--instructions") ?? "",
    }),
  });
  output.write(`Агент создан: ${value(result.profile.name)} (${value(result.profile.id)})\n`);
}

async function deleteAgentProfile(ctx: CliContext, id: string): Promise<void> {
  if (!id) throw new Error("Укажите ID агента");
  await ctx.api.request(`/v1/agents/${encodeURIComponent(id)}?userId=${encodeURIComponent(ctx.userId)}`, { method: "DELETE" });
  output.write(`Агент удалён: ${id}\n`);
}

async function integrations(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ connectors: JsonObject[] }>(`/v1/connectors?userId=${encodeURIComponent(ctx.userId)}`);
  output.write(`${renderRows(result.connectors, ["id", "provider", "label", "updatedAt"])}\n`);
}

async function addIntegration(ctx: CliContext, args: string[]): Promise<void> {
  const provider = args[2] ?? "";
  const label = args[3] ?? "";
  if (!provider || !label) throw new Error("Использование: integrations add PROVIDER LABEL [--endpoint HTTPS_URL]");
  const allowed = ["github", "google_drive", "gmail", "google_calendar", "mcp_http"];
  if (!allowed.includes(provider)) throw new Error(`Провайдер должен быть одним из: ${allowed.join(", ")}`);
  const endpoint = option(args, "--endpoint");
  if (provider === "mcp_http" && !endpoint) throw new Error("Для MCP укажите --endpoint HTTPS_URL");
  const secret = await readHiddenSecret(provider === "mcp_http" ? "Bearer token (введите - если не нужен): " : "Access token: ");
  if (!secret) throw new Error("Секрет не может быть пустым");
  const result = await ctx.api.request<{ connector: JsonObject }>("/v1/connectors", {
    method: "POST",
    body: JSON.stringify({
      userId: ctx.userId, provider, label, secret,
      ...(endpoint ? { metadata: { endpoint } } : {}),
    }),
  });
  output.write(`Подключение сохранено и зашифровано: ${value(result.connector.id)}\n`);
}

async function testIntegration(ctx: CliContext, id: string): Promise<void> {
  if (!id) throw new Error("Укажите ID подключения");
  const listed = await ctx.api.request<{ connectors: JsonObject[] }>(`/v1/connectors?userId=${encodeURIComponent(ctx.userId)}`);
  const connector = listed.connectors.find((item) => value(item.id) === id);
  if (!connector) throw new Error("Подключение не найдено");
  const provider = value(connector.provider);
  const query = `userId=${encodeURIComponent(ctx.userId)}&connectorId=${encodeURIComponent(id)}`;
  if (provider === "github") await ctx.api.request(`/v1/integrations/github/profile?${query}`);
  else if (provider === "google_drive") await ctx.api.request(`/v1/integrations/google-drive/files?${query}&limit=1`);
  else if (provider === "gmail") await ctx.api.request(`/v1/integrations/gmail/messages?${query}&limit=1`);
  else if (provider === "google_calendar") await ctx.api.request(`/v1/integrations/google-calendar/events?${query}&limit=1`);
  else if (provider === "mcp_http") await ctx.api.request(`/v1/integrations/mcp/tools?${query}`);
  else throw new Error("Проверка этого провайдера не поддерживается");
  output.write(`Подключение работает: ${value(connector.label)}\n`);
}

async function deleteIntegration(ctx: CliContext, id: string): Promise<void> {
  if (!id) throw new Error("Укажите ID подключения");
  await ctx.api.request(`/v1/connectors/${encodeURIComponent(id)}`, {
    method: "DELETE", body: JSON.stringify({ userId: ctx.userId }),
  });
  output.write(`Подключение удалено: ${id}\n`);
}

async function conversation(ctx: CliContext, id: string): Promise<JsonObject> {
  if (!id) throw new Error("Укажите ID диалога");
  const result = await ctx.api.request<{ conversation: JsonObject }>(
    `/v1/conversations/${encodeURIComponent(id)}?userId=${encodeURIComponent(ctx.userId)}`,
  );
  return result.conversation;
}

function tuiHelp(): void {
  output.write(`Команды чата:
  /new                         новый диалог
  /session                     текущий диалог
  /use <id>                    продолжить сохранённый диалог
  /sessions                    список диалогов
  /status                      состояние Barlas
  /runs | /jobs | /tasks       выполняемая работа
  /cron | /projects            расписания и проекты
  /agents                      отдельные агенты
  /agent <id|none>             выбрать агента для нового диалога
  /memory <запрос>             поиск памяти
  /skills | /plugins           навыки и расширения
  /models | /channels          модели и каналы
  /tools | /nodes              инструменты и устройства
  /approvals                   ожидающие подтверждения
  /approve <id> | /reject <id> решение по действию
  /cancel <run-id>             отменить запуск
  /audit                       журнал действий
  /help                        эта справка
  /quit                        выход
Обычный текст продолжает текущий диалог.
`);
}

function help(): void {
  output.write(`Barlas CLI — управление автономным агентом

Настройка (Windows):
  onboard                           полный мастер настройки
  configure [section]               изменить all/general/models/channels/agent
  config list|get|set|unset         управление конфигурацией
  models status|configure           модели и ключи
  channels status|add|configure     каналы связи
  security audit                    локальная проверка безопасности

Агент:
  chat | tui | terminal             интерактивный чат
  agent <запрос> | ask <запрос>     автономная задача
  agent <запрос> --profile <id>     задача отдельному агенту
  agents                            список отдельных агентов
  council                           Глава Barlas и внутренний Совет
  agents create SLUG NAME [...]     создать агента и привязать workspace
  agents delete <id>                удалить агента
  integrations                      подключения без раскрытия секретов
  integrations add PROVIDER LABEL   безопасно запросить и зашифровать токен
  integrations test <id>            проверить реальное соединение
  integrations delete <id>          удалить подключение
  status | health | doctor          состояние и диагностика
  dashboard                         открыть кабинет (Windows)
  desktop [open|install|uninstall|status]
                                    отдельное desktop-окно Barlas (Windows)
  voice test                        приватная проверка микрофона и голоса (Windows)

Работа:
  pause [причина]                   аварийно остановить новые задачи и workers
  resume                            продолжить работу после общей паузы
  system status                     показать состояние общей паузы
  runs                              последние запуски
  runs cancel <id>                  отменить запуск
  jobs                              фоновые задачи
  jobs cancel|retry <id>            управление задачей
  tasks                             запуски и фоновые задачи
  cron | schedules                  расписания
  cron pause|resume|disable <id>    управление расписанием
  approvals                         подтверждения
  approve|reject <id>               принять или отклонить
  projects                          проекты

Знания и расширения:
  memory search <запрос>            поиск памяти
  sessions | transcripts            диалоги
  skills                            установленные навыки
  skills inspect-agent <path>       проверить открытый SKILL.md и получить SHA-256
  skills import-agent <path> --trust-sha256 DIGEST [--id ID] [--version X.Y.Z] [--allow-tools a,b]
                                    импортировать skills.sh/Agent Skills как неактивный кандидат
  skills verify <package.json>      проверить подпись и отпечаток издателя
  skills install <json> --trust FP  установить, проверить и активировать пакет
  skills keygen <prefix>            создать Ed25519-ключ издателя
  skills sign <tpl> <key> <output>  подписать пакет навыка
  skills catalog verify <src> --trust-catalog FP
                                    проверить подпись, срок и отозванные пакеты
  skills catalog list <src> --trust-catalog FP [--query TEXT]
                                    найти неотозванные навыки
  skills catalog install <src> <id> [version] --trust-catalog FP --trust-publisher FP
                                    скачать по HTTPS, сверить хеш и установить
  skills catalog sign <tpl> <key> <output> --name NAME
                                    подписать декларативный каталог
  skills evaluate <id> <ver> <json> прогнать acceptance cases
  skills activate <id> <version>    активировать прошедшую проверку версию
  skills rollback <id> <version>    откатить на проверенную версию
  plugins | extensions              расширения
  models                            провайдеры моделей
  channels                          каналы связи
  tools                             доступные инструменты
  nodes | devices                   подключённые устройства
  node-pair                         код подключения
  node install|uninstall            Windows tray node (нативная установка)
  audit                             журнал действий

Система Windows:
  backup create [file] [--source DIR] создать проверяемый архив состояния
  backup verify FILE                 проверить CRC, состав и SHA-256
  backup restore FILE --force        восстановить состояние с проверкой путей
  completion SHELL                  completion для bash/zsh/fish/powershell
  gateway status                    состояние Gateway
  gateway start|stop|restart        управление Gateway
  gateway health                    диагностика Gateway
  web test                          проверить поиск, чтение и Chromium
  web repair                        скачать Chromium и повторить проверку
  gateway logs [--follow]           логи Gateway
  daemon ...                        алиас для gateway
  start | stop | restart            короткие алиасы
  logs                              последние логи
  update [check|rollback|repair]    обновление и откат
  repair                            восстановить установку
  uninstall [--purge]               удалить; данные сохраняются по умолчанию
  help                              эта справка
`);
}

async function tui(ctx: CliContext): Promise<void> {
  const readline = createInterface({ input, output, terminal: true });
  let conversationId: string | undefined;
  let agentId: string | undefined;
  const red = "\x1b[38;2;226;31;61m";
  const white = "\x1b[97m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";
  output.write(`
${red} ▄██▄  ▄██▄${reset}
${red} ▀██▀  ▀██▀${reset}   ${white}█▀▀▄ ▄▀▀▄ █▀▀▄ █    ▄▀▀▄ ▄▀▀▀${reset}
              ${white}█▀▀▄ █▀▀█ █▀█  █    █▀▀█  ▀▀▄${reset}
${red}    ▄██▄${reset}      ${white}▀▀▀  ▀  ▀ ▀  ▀ ▀▀▀▀ ▀  ▀ ▀▀▀${reset}
${red}    ▀██▀${reset}                ${dim}A I   A G E N T${reset}
              ${red}THINK AHEAD.${reset} ${white}ACT BEYOND.${reset}

Живой диалог · /help · /quit

`);
  try {
    while (true) {
      const line = (await readline.question("barlas> ")).trim();
      if (!line) continue;
      if (["/quit", "/exit"].includes(line)) break;
      try {
        if (line === "/help") { tuiHelp(); continue; }
        if (line === "/new") {
          conversationId = undefined;
          output.write("Новый диалог начнётся со следующего сообщения.\n");
          continue;
        }
        if (line === "/session") {
          if (!conversationId) output.write("Диалог ещё не начат.\n");
          else output.write(`Текущий диалог: ${conversationId}\n`);
          continue;
        }
        if (line.startsWith("/use ")) {
          const id = line.slice(5).trim();
          const selected = await conversation(ctx, id);
          conversationId = id;
          output.write(`Продолжаем: ${value(selected.title)} (${value(selected.messageCount)} сообщений)\n`);
          continue;
        }
        if (line === "/sessions") { await sessions(ctx); continue; }
        if (line === "/status") { await status(ctx); continue; }
        if (line === "/runs") { await list(ctx, "agent-runs"); continue; }
        if (line === "/jobs") { await list(ctx, "jobs"); continue; }
        if (line === "/tasks") { await list(ctx, "agent-runs"); await list(ctx, "jobs"); continue; }
        if (line === "/cron") { await list(ctx, "schedules"); continue; }
        if (line === "/projects") { await list(ctx, "projects"); continue; }
        if (line === "/agents") { await agents(ctx); continue; }
        if (line.startsWith("/agent ")) {
          const selected = line.slice(7).trim();
          agentId = selected === "none" ? undefined : selected;
          conversationId = undefined;
          output.write(agentId ? `Выбран агент ${agentId}. Начнётся новый диалог.\n` : "Выбран основной агент. Начнётся новый диалог.\n");
          continue;
        }
        if (line.startsWith("/memory ")) { await memorySearch(ctx, line.slice(8).trim()); continue; }
        if (line === "/skills") { await skills(ctx); continue; }
        if (["/plugins", "/extensions"].includes(line)) { await extensionsCatalog(ctx); continue; }
        if (line === "/models") { await extensionsCatalog(ctx, "provider"); continue; }
        if (line === "/channels") { await extensionsCatalog(ctx, "channel"); continue; }
        if (line === "/tools") { await tools(ctx); continue; }
        if (line === "/approvals") { await list(ctx, "approvals"); continue; }
        if (line === "/audit") { await audit(ctx); continue; }
        if (line === "/nodes") { await nodes(ctx); continue; }
        if (line === "/node-pair") { await nodePairingCode(ctx); continue; }
        if (line.startsWith("/cancel ")) { await action(ctx, "agent-runs", line.slice(8).trim(), "cancel"); continue; }
        if (line.startsWith("/approve ")) { await decide(ctx, line.slice(9).trim(), true); continue; }
        if (line.startsWith("/reject ")) { await decide(ctx, line.slice(8).trim(), false); continue; }
        if (line.startsWith("/")) {
          output.write("Неизвестная команда. Введите /help.\n");
          continue;
        }
        conversationId = await ask(ctx, line, conversationId, agentId);
      } catch (error) {
        output.write(`Ошибка: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    readline.close();
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? (process.stdin.isTTY ? "tui" : "help");
  if (["help", "--help", "-h"].includes(command)) { help(); return; }
  if (command === "completion") { output.write(generateShellCompletion(args[1] ?? "")); return; }
  if (command === "backup") return backupCommand(args);
  if (command === "skills" && args[1] === "inspect-agent") return inspectAgentSkill(args[2] ?? "");
  if (command === "skills" && args[1] === "verify") return verifySkillPackageFile(args[2] ?? "");
  if (command === "skills" && args[1] === "keygen") return createSkillSigningKey(args[2] ?? "");
  if (command === "skills" && args[1] === "sign") return signSkillPackageFile(args[2] ?? "", args[3] ?? "", args[4] ?? "");
  if (command === "skills" && args[1] === "catalog" && args[2] === "verify") {
    return verifyCatalogFile(args[3] ?? "", option(args, "--trust-catalog") ?? "");
  }
  if (command === "skills" && args[1] === "catalog" && args[2] === "list") {
    return listSkillCatalog(args[3] ?? "", option(args, "--trust-catalog") ?? "", option(args, "--query") ?? "");
  }
  if (command === "skills" && args[1] === "catalog" && args[2] === "sign") {
    return signSkillCatalogFile(args[3] ?? "", args[4] ?? "", args[5] ?? "", option(args, "--name") ?? "");
  }
  const ctx = await context();
  if (command === "pause") return runtimeControl(ctx, "pause", args.slice(1).join(" ").trim());
  if (command === "resume") return runtimeControl(ctx, "resume");
  if (command === "system" && (args[1] ?? "status") === "status") return runtimeControl(ctx, "status");
  if (["tui", "chat", "terminal"].includes(command)) return tui(ctx);
  if (["ask", "agent"].includes(command)) {
    const profileId = option(args, "--profile");
    const promptParts: string[] = [];
    for (let index = 1; index < args.length; index++) {
      if (args[index] === "--profile") { index += 1; continue; }
      promptParts.push(args[index]!);
    }
    await ask(ctx, promptParts.join(" ").trim() || (() => { throw new Error("Укажите запрос"); })(), undefined, profileId);
    return;
  }
  if (command === "agents" && args[1] === "create") return createAgentProfile(ctx, args);
  if (command === "agents" && args[1] === "delete") return deleteAgentProfile(ctx, args[2] ?? "");
  if (command === "agents") return agents(ctx);
  if (command === "council") return council(ctx);
  if (command === "integrations" && args[1] === "add") return addIntegration(ctx, args);
  if (command === "integrations" && args[1] === "test") return testIntegration(ctx, args[2] ?? "");
  if (command === "integrations" && args[1] === "delete") return deleteIntegration(ctx, args[2] ?? "");
  if (command === "integrations") return integrations(ctx);
  if (command === "status") return status(ctx);
  if (["health", "doctor"].includes(command)) return doctor(ctx);
  if (command === "extensions") return extensions(ctx);
  if (["plugins"].includes(command)) return extensionsCatalog(ctx);
  if (command === "models") return extensionsCatalog(ctx, "provider");
  if (command === "channels") return extensionsCatalog(ctx, "channel");
  if (command === "skills" && args[1] === "catalog" && args[2] === "install") {
    const candidateVersion = args[5] && !args[5]!.startsWith("--") ? args[5] : undefined;
    return installSkillFromCatalog(
      ctx,
      args[3] ?? "",
      args[4] ?? "",
      candidateVersion,
      option(args, "--trust-catalog") ?? "",
      option(args, "--trust-publisher") ?? "",
    );
  }
  if (command === "skills" && args[1] === "install") {
    return installSkillPackage(ctx, args[2] ?? "", option(args, "--trust") ?? "");
  }
  if (command === "skills" && args[1] === "import-agent") return importAgentSkill(ctx, args);
  if (command === "skills" && args[1] === "evaluate") return evaluateSkill(ctx, args[2] ?? "", args[3] ?? "", args[4] ?? "");
  if (command === "skills" && ["activate", "rollback"].includes(args[1] ?? "")) return activateSkill(ctx, args[2] ?? "", args[3] ?? "");
  if (command === "skills") return skills(ctx);
  if (command === "tools") return tools(ctx);
  if (["sessions", "transcripts"].includes(command)) return sessions(ctx);
  if (command === "memory" && args[1] === "search") return memorySearch(ctx, args.slice(2).join(" ").trim());
  if (command === "audit") return audit(ctx);
  if (["nodes", "devices"].includes(command)) return nodes(ctx);
  if (command === "node-pair") return nodePairingCode(ctx);
  if (command === "runs" && args[1] === "cancel") return action(ctx, "agent-runs", args[2] ?? "", "cancel");
  if (command === "runs") return list(ctx, "agent-runs");
  if (command === "jobs" && ["cancel", "retry"].includes(args[1] ?? "")) return action(ctx, "jobs", args[2] ?? "", args[1]!);
  if (["cron", "schedules"].includes(command) && ["pause", "resume", "disable"].includes(args[1] ?? "")) {
    return action(ctx, "schedules", args[2] ?? "", args[1]!);
  }
  if (["cron", "schedules"].includes(command)) return list(ctx, "schedules");
  if (command === "tasks") { await list(ctx, "agent-runs"); return list(ctx, "jobs"); }
  if (["approvals", "jobs", "projects", "schedules"].includes(command)) return list(ctx, command as "approvals" | "jobs" | "projects" | "schedules");
  if (command === "approve" || command === "reject") {
    if (!args[1]) throw new Error("Укажите ID подтверждения");
    return decide(ctx, args[1], command === "approve");
  }
  throw new Error(`Неизвестная команда: ${command}`);
}

if (process.argv[1]?.endsWith("cli.js")) {
  main().catch((error) => {
    process.stderr.write(`Barlas CLI: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
