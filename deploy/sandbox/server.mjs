import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, chown, lchown, lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SOCKET_PATH = process.env.SANDBOX_SOCKET_PATH ?? "/run/barlas-sandbox/sandbox.sock";
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT ?? "/workspace");
const TOKEN = process.env.SANDBOX_SHARED_TOKEN ?? "";
const SOCKET_GID = Number.parseInt(process.env.SANDBOX_SOCKET_GID ?? "2000", 10);
const API_UID = Number.parseInt(process.env.SANDBOX_API_UID ?? "1000", 10);
const API_GID = Number.parseInt(process.env.SANDBOX_API_GID ?? "1000", 10);
const MAX_REQUEST_BYTES = 100_000;
const MAX_OUTPUT_BYTES = 100_000;
const MAX_CONCURRENT = 2;
const COMMANDS = new Map([
  ["python", "/usr/bin/python3"],
  ["node", "/usr/local/bin/node"],
  ["git", "/usr/bin/git"],
  ["npm", "/usr/local/bin/npm"],
]);

if (TOKEN.length < 32) throw new Error("SANDBOX_SHARED_TOKEN must contain at least 32 characters");
if (![SOCKET_GID, API_UID, API_GID].every(Number.isSafeInteger)) throw new Error("Sandbox UID/GID settings must be integers");
let active = 0;
const activeUsers = new Set();

await mkdir(dirname(SOCKET_PATH), { recursive: true, mode: 0o770 });
await chown(dirname(SOCKET_PATH), 0, SOCKET_GID);
await chmod(dirname(SOCKET_PATH), 0o770);
await rm(SOCKET_PATH, { force: true });
await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o711 });
await chmod(WORKSPACE_ROOT, 0o711);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { status: "ok" });
    if (request.method !== "POST" || request.url !== "/run") return json(response, 404, { error: "Not found" });
    if (!authorized(request.headers.authorization)) return json(response, 401, { error: "Unauthorized" });
    if (active >= MAX_CONCURRENT) return json(response, 429, { error: "Sandbox is busy" });
    const body = await readBody(request);
    const input = validate(body);
    active += 1;
    if (activeUsers.has(input.userId)) {
      active -= 1;
      return json(response, 409, { error: "A sandbox command is already running for this user" });
    }
    activeUsers.add(input.userId);
    try {
      return json(response, 200, await execute(input));
    } finally {
      activeUsers.delete(input.userId);
      active -= 1;
    }
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message.slice(0, 500) : "Invalid request" });
  }
});

server.listen(SOCKET_PATH, async () => {
  await chown(SOCKET_PATH, 0, SOCKET_GID);
  await chmod(SOCKET_PATH, 0o660);
});

async function execute(input) {
  const userKey = createHash("sha256").update(input.userId).digest("hex");
  const userRoot = resolve(WORKSPACE_ROOT, userKey);
  await mkdir(userRoot, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(userRoot);
  const requested = resolve(canonicalRoot, input.cwd);
  assertInside(canonicalRoot, requested);
  const cwd = await realpath(requested);
  assertInside(canonicalRoot, cwd);
  const runUid = randomInt(100_000, 2_000_000_000);
  await changeOwnership(canonicalRoot, runUid, runUid);
  const started = Date.now();
  let child;
  try {
    child = spawn(COMMANDS.get(input.command), input.args, {
      cwd,
      uid: runUid,
      gid: runUid,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        HOME: canonicalRoot,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        npm_config_cache: `/tmp/npm-cache-${runUid}`,
        npm_config_update_notifier: "false",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    const collect = (current, chunk) => {
      if (current.length >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return current;
      }
      const remaining = MAX_OUTPUT_BYTES - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }, input.timeoutSeconds * 1_000);
    const outcome = await new Promise((resolveOutcome, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => resolveOutcome({ exitCode, signal }));
    }).finally(() => clearTimeout(timer));
    return {
      command: input.command,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      timedOut,
      outputTruncated: truncated,
      durationMs: Date.now() - started,
    };
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
    await killUidProcesses(runUid);
    await changeOwnership(canonicalRoot, API_UID, API_GID);
  }
}

async function changeOwnership(path, uid, gid) {
  const info = await lstat(path);
  if (info.isDirectory() && !info.isSymbolicLink()) {
    for (const entry of await readdir(path)) await changeOwnership(resolve(path, entry), uid, gid);
  }
  await lchown(path, uid, gid);
}

async function killUidProcesses(uid) {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      const status = await readFile(`/proc/${entry}/status`, "utf8");
      if (Number.parseInt(status.match(/^Uid:\s+(\d+)/mu)?.[1] ?? "-1", 10) === uid) process.kill(Number(entry), "SIGKILL");
    } catch {}
  }
}

function validate(value) {
  if (!value || typeof value !== "object") throw new Error("JSON object required");
  if (typeof value.userId !== "string" || value.userId.length < 1 || value.userId.length > 128) throw new Error("Invalid userId");
  if (!COMMANDS.has(value.command)) throw new Error("Command is not allowed");
  if (!Array.isArray(value.args) || value.args.length > 64 || value.args.some((arg) => typeof arg !== "string" || arg.length > 500 || arg.includes("\0"))) {
    throw new Error("Invalid command arguments");
  }
  const cwd = value.cwd ?? ".";
  if (typeof cwd !== "string" || !cwd || cwd.length > 1_000 || cwd.includes("\0") || isAbsolute(cwd)) throw new Error("Invalid working directory");
  const timeoutSeconds = value.timeoutSeconds ?? 30;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) throw new Error("Invalid timeout");
  return { userId: value.userId, command: value.command, args: value.args, cwd, timeoutSeconds };
}

function assertInside(root, target) {
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("Path escapes the user workspace");
}

function authorized(header) {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request exceeds 100 KB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}
