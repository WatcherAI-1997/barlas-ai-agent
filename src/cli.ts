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
}

async function context(): Promise<CliContext> {
  const url = process.env.BARLAS_URL ?? "http://127.0.0.1:17840";
  const token = process.env.BARLAS_TOKEN ?? process.env.BARLAS_GATEWAY_TOKEN ?? process.env.BARLAS_API_TOKEN;
  if (!token) throw new Error("BARLAS_TOKEN or a protected Barlas service token is required");
  const api = new BarlasApiClient(url, token);
  const me = await api.request<{ principal: { id: string } }>("/v1/me");
  return { api, userId: me.principal.id };
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

async function decide(ctx: CliContext, id: string, approved: boolean): Promise<void> {
  const result = await ctx.api.request<JsonObject>(`/v1/approvals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ userId: ctx.userId, approved }),
  });
  output.write(`${approved ? "Разрешено" : "Отклонено"}: ${id}\n${JSON.stringify(result, null, 2)}\n`);
}

async function ask(ctx: CliContext, prompt: string): Promise<void> {
  const accepted = await ctx.api.request<{ runId?: string; message?: { content?: string }; status?: string }>("/v1/agent/run", {
    method: "POST",
    body: JSON.stringify({
      userId: ctx.userId,
      messages: [{ role: "user", content: prompt }],
      taskClass: "fast",
      maxSteps: 8,
    }),
  });
  if (!accepted.runId) {
    output.write(`${accepted.message?.content ?? JSON.stringify(accepted)}\n`);
    return;
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
      return;
    }
    const result = response.run.result as { text?: string } | undefined;
    if (result?.text) output.write(`${result.text}\n`);
    else if (response.run.error) output.write(`Ошибка: ${value(response.run.error)}\n`);
    else output.write(`${JSON.stringify(response.run, null, 2)}\n`);
    return;
  }
}

function help(): void {
  output.write(`Barlas CLI\n\nКоманды:\n  tui                     интерактивный терминал\n  ask <запрос>            автономная задача\n  status                  состояние и метрики\n  runs                    последние запуски\n  approvals               очередь подтверждений\n  approve <id>            разрешить действие\n  reject <id>             отклонить действие\n  jobs                    фоновые задачи\n  projects                проекты\n  schedules               расписания\n  extensions              каталог расширений\n  help                    эта справка\n`);
}

async function tui(ctx: CliContext): Promise<void> {
  const readline = createInterface({ input, output, terminal: true });
  output.write("\n⬤  ⬤  Barlas CLI\n  ⬤   /help · /quit\n\n");
  try {
    while (true) {
      const line = (await readline.question("barlas> ")).trim();
      if (!line) continue;
      if (["/quit", "/exit"].includes(line)) break;
      if (line === "/help") { help(); continue; }
      if (line === "/status") { await status(ctx); continue; }
      if (line === "/approvals") { await list(ctx, "approvals"); continue; }
      if (line === "/extensions") { await extensions(ctx); continue; }
      if (line.startsWith("/approve ")) { await decide(ctx, line.slice(9).trim(), true); continue; }
      if (line.startsWith("/reject ")) { await decide(ctx, line.slice(8).trim(), false); continue; }
      await ask(ctx, line);
    }
  } finally {
    readline.close();
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? (process.stdin.isTTY ? "tui" : "help");
  if (["help", "--help", "-h"].includes(command)) { help(); return; }
  const ctx = await context();
  if (command === "tui") return tui(ctx);
  if (command === "ask") return ask(ctx, args.slice(1).join(" ").trim() || (() => { throw new Error("Укажите запрос"); })());
  if (command === "status") return status(ctx);
  if (command === "extensions") return extensions(ctx);
  if (command === "runs") return list(ctx, "agent-runs");
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
