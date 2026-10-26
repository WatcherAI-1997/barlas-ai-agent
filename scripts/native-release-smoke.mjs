import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataRoot = await mkdtemp(join(tmpdir(), "barlas-native-release-"));
const apiToken = "release-smoke-api-token-00000000000000000000000000000000000000000000";
const gatewayToken = "release-smoke-gateway-token-000000000000000000000000000000000000000";
const vaultKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");
const userId = "release-smoke";
let runtime;

function listen(server, port = 0) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

async function freePort() {
  const server = createTcpServer();
  const port = await listen(server);
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

const modelServer = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const parsed = JSON.parse(body);
    if (parsed.model !== "barlas-release-model" || !Array.isArray(parsed.messages)) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid request" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      id: "release-smoke-response",
      model: "barlas-release-model",
      choices: [{ message: { role: "assistant", content: "Barlas release smoke passed" } }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }));
  });
});

const modelPort = await listen(modelServer);
const appPort = await freePort();
const databasePort = await freePort();
const baseUrl = `http://127.0.0.1:${appPort}`;

const runtimeEnvironment = {
  ...process.env,
  APP_ENV: "production",
  APP_NAME: "Barlas AI Agent",
  HOST: "127.0.0.1",
  PORT: String(appPort),
  DATABASE_URL: "postgresql://native-runtime",
  BARLAS_NATIVE_ROOT: root,
  BARLAS_NATIVE_DATA: join(dataRoot, "data"),
  BARLAS_NATIVE_DATABASE_PORT: String(databasePort),
  BARLAS_API_TOKEN: apiToken,
  BARLAS_GATEWAY_TOKEN: gatewayToken,
  MODEL_PROVIDER: "openai_compatible",
  MODEL_NAME: "barlas-release-model",
  MODEL_API_KEY: "release-smoke-model-key",
  MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
  CONNECTOR_VAULT_KEY: vaultKey,
  OWNER_EMAIL: "owner@barlas.local",
  OWNER_DISPLAY_NAME: "Barlas Owner",
  WORKSPACE_ROOT: join(dataRoot, "workspaces"),
  WEB_ROOT: join(root, "web"),
  JOB_WORKER_ENABLED: "false",
  AGENT_RUN_WORKER_ENABLED: "false",
  TELEGRAM_POLLING_ENABLED: "false",
  DISCORD_GATEWAY_ENABLED: "false",
  SLACK_SOCKET_MODE_ENABLED: "false",
  LOG_LEVEL: "warn",
};

function startRuntime() {
  const child = spawn(process.execPath, [join(root, "dist", "src", "native.js")], {
    cwd: root,
    env: runtimeEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.output = () => output;
  return child;
}

async function stopRuntime() {
  if (!runtime || runtime.exitCode !== null) return;
  runtime.kill("SIGTERM");
  const timeout = setTimeout(() => runtime?.kill("SIGKILL"), 10_000);
  try { await once(runtime, "exit"); } finally { clearTimeout(timeout); }
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitReady() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null) throw new Error(`Native runtime exited early (${runtime.exitCode}):\n${runtime.output()}`);
    try {
      const ready = await request("/ready");
      if (ready?.status === "ready") return;
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Native runtime did not become ready: ${lastError}\n${runtime.output()}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  runtime = startRuntime();
  await waitReady();

  const health = await request("/health");
  assert(health?.status === "ok", "Health check failed");

  const chat = await request("/v1/chat", {
    method: "POST",
    body: JSON.stringify({ userId, messages: [{ role: "user", content: "Verify this release" }], taskClass: "fast" }),
  });
  assert(chat?.message?.content === "Barlas release smoke passed", "Chat response was not persisted correctly");
  assert(typeof chat?.conversationId === "string", "Chat did not return a conversation ID");

  const tool = await request("/v1/tools/execute", {
    method: "POST",
    body: JSON.stringify({
      userId,
      toolName: "text.statistics",
      toolInput: { text: "Barlas stable release" },
      summary: "Verify read-only tool execution",
    }),
  });
  assert(tool?.status === "completed" && tool?.output?.words === 3, "Read-only tool execution failed");

  const marker = `Barlas native release ${Date.now()}`;
  await request("/v1/memory", {
    method: "POST",
    body: JSON.stringify({ userId, content: marker, category: "release", importance: 10 }),
  });

  await stopRuntime();
  runtime = startRuntime();
  await waitReady();

  const memories = await request(`/v1/memory/search?userId=${encodeURIComponent(userId)}&query=${encodeURIComponent(marker)}`);
  assert(memories?.memories?.some((memory) => memory.content === marker), "Memory did not survive restart");

  const conversation = await request(`/v1/conversations/${chat.conversationId}?userId=${encodeURIComponent(userId)}`);
  assert(conversation?.conversation?.messages?.some((message) => message.content === "Barlas release smoke passed"), "Conversation did not survive restart");

  console.log("Barlas native release smoke passed: health, chat, tool, memory, graceful restart, persistence.");
} finally {
  await stopRuntime().catch(() => undefined);
  await new Promise((resolveClose) => modelServer.close(resolveClose));
  await rm(dataRoot, { recursive: true, force: true });
}
