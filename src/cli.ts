#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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

async function catalog(ctx: CliContext, kind?: string): Promise<void> {
  const result = await ctx.api.request<{ extensions: JsonObject[] }>("/v1/extensions");
  const rows = kind ? result.extensions.filter((item) => value(item.kind) === kind) : result.extensions;
  output.write(`${renderRows(rows, ["id", "kind", "configured", "capabilities"])}\n`);
}

async function skills(ctx: CliContext): Promise<void> {
  const result = await ctx.api.request<{ skills: JsonObject[] }>("/v1/skills");
  output.write(`${renderRows(result.skills, ["id", "version", "name", "active", "allowedTools"])}\n`);
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
  plugins | extensions              расширения
  models                            провайдеры моделей
  channels                          каналы связи
  tools                             доступные инструменты
  nodes | devices                   подключённые устройства
  node-pair                         код подключения
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
        if (["/plugins", "/extensions"].includes(line)) { await catalog(ctx); continue; }
        if (line === "/models") { await catalog(ctx, "provider"); continue; }
        if (line === "/channels") { await catalog(ctx, "channel"); continue; }
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
  const ctx = await context();
  if (["tui", "chat", "terminal"].includes(command)) return tui(ctx);
  if (["ask", "agent"].includes(command)) {
    await ask(ctx, args.slice(1).join(" ").trim() || (() => { throw new Error("Укажите запрос"); })());
    return;
  }
  if (command === "status") return status(ctx);
  if (["health", "doctor"].includes(command)) return doctor(ctx);
  if (command === "extensions") return extensions(ctx);
  if (["plugins"].includes(command)) return catalog(ctx);
  if (command === "models") return catalog(ctx, "provider");
  if (command === "channels") return catalog(ctx, "channel");
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
