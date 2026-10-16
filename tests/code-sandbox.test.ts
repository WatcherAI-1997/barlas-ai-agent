import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CodeSandboxClient } from "../src/tools/code-sandbox.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("code sandbox client", () => {
  it("uses a private Unix socket and authenticated bounded JSON request", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-sandbox-client-"));
    roots.push(root);
    const socketPath = join(root, "sandbox.sock");
    const token = "s".repeat(32);
    const server = createServer(async (request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toMatchObject({
        userId: "user-1", command: "python", args: ["-c", "print(42)"], cwd: ".",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        command: "python", exitCode: 0, signal: null, stdout: "42\n", stderr: "",
        timedOut: false, outputTruncated: false, durationMs: 4,
      }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    try {
      await expect(new CodeSandboxClient(socketPath, token).run({
        userId: "user-1", command: "python", args: ["-c", "print(42)"], cwd: ".",
      })).resolves.toMatchObject({ exitCode: 0, stdout: "42\n", timedOut: false });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
