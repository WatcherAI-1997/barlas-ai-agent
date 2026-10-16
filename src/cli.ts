#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

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
  const [health, ready] = await Promise.all([
    ctx.api.request<{ status: string }>("/health"),
    ctx.api.request<{ status: string }>("/ready"),
  ]);
  output.write(`API: ${health.status}\nRuntime: ${ready.status}\nGateway: authenticated\nURL: ${ctx.baseUrl}\n`);
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

async function ask(ctx: CliContext, prompt: string, conversationId?: string): Promise<string | undefined> {
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
      messages: [{ role: "user", content: prompt }],
      taskClass: "fast",
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
  output.write(`Barlas CLI — команды в стиле OpenClaw

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
  status | health | doctor          состояние и диагностика
  dashboard                         открыть кабинет (Windows)

Работа:
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
  gateway status                    состояние Gateway
  gateway start|stop|restart        управление Gateway
  gateway health                    диагностика Gateway
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
  output.write("\n⬤  ⬤  Barlas\n  ⬤   живой диалог · /help · /quit\n\n");
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
        conversationId = await ask(ctx, line, conversationId);
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
  if (["tui", "chat", "terminal"].includes(command)) return tui(ctx);
  if (["ask", "agent"].includes(command)) {
    await ask(ctx, args.slice(1).join(" ").trim() || (() => { throw new Error("Укажите запрос"); })());
    return;
  }
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
