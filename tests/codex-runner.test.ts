import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CodexWorkspaceRunner } from "../src/tools/codex-runner.js";
import { FileWorkspace } from "../src/tools/file-workspace.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

describe("approval-gated Codex workspace runner", () => {
  it("runs only in the owning workspace and returns a bounded factual summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-runner-test-"));
    try {
      const workspace = new FileWorkspace(root);
      await workspace.write("owner-a", "repo/input.txt", "source");
      const calls: Array<{ prompt: string; cwd: string; model: string; timeoutSeconds: number; schemaPath: string }> = [];
      const runner = new CodexWorkspaceRunner(workspace, {
        model: "account-model",
        runCli: async ({ prompt, cwd, model, timeoutSeconds, outputPath, schemaPath }) => {
          calls.push({ prompt, cwd, model, timeoutSeconds, schemaPath });
          await writeFile(outputPath, JSON.stringify({
            summary: "Added output.txt.",
            verification: "Runtime verification was not run.",
            writes: [{ path: "output.txt", content: "result\n" }],
          }), "utf8");
        },
      });

      const result = await runner.run("owner-a", {
        objective: "Make the smallest safe change",
        path: "repo",
        timeoutSeconds: 90,
      });

      expect(result).toMatchObject({
        runner: "codex",
        model: "account-model",
        path: "repo",
        summary: "Added output.txt.",
        verification: "Runtime verification was not run.",
        changedFiles: ["output.txt"],
      });
      expect(calls[0]?.prompt).toContain("no shell, network");
      expect(calls[0]?.prompt).toContain("input.txt");
      expect(calls[0]?.prompt).toContain("source");
      expect(calls[0]?.prompt).toContain("Make the smallest safe change");
      expect(calls[0]?.timeoutSeconds).toBe(90);
      expect(calls[0]?.schemaPath).toContain("response.schema.json");
      await expect(workspace.read("owner-a", "repo/output.txt")).resolves.toMatchObject({ content: "result\n" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("registers execution only when configured and keeps it approval-gated", () => {
    expect(createBuiltinToolRegistry().list().some((tool) => tool.name === "runner.codex.execute")).toBe(false);
    const run = vi.fn();
    const registry = createBuiltinToolRegistry({ codexRunner: { run } });
    expect(registry.list()).toContainEqual(expect.objectContaining({
      name: "runner.codex.execute",
      risk: "external",
    }));
  });

  it("rejects a runner path outside the owning workspace before invoking the CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-runner-boundary-"));
    try {
      const runCli = vi.fn();
      const runner = new CodexWorkspaceRunner(new FileWorkspace(root), {
        model: "account-model",
        runCli,
      });
      await expect(runner.run("owner-a", {
        objective: "Inspect outside",
        path: "../",
        timeoutSeconds: 90,
      })).rejects.toThrow(/escapes/u);
      expect(runCli).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("omits credential-like files and rejects escaping structured writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-runner-output-"));
    try {
      const workspace = new FileWorkspace(root);
      await workspace.write("owner-a", "repo/source.ts", "export const value = 1;\n");
      await workspace.write("owner-a", "repo/.env", "PRIVATE_TOKEN=do-not-send\n");
      const credentialLike = ["sk", "x".repeat(32)].join("-");
      await workspace.write("owner-a", "repo/config.txt", `token=${credentialLike}\n`);
      let observedPrompt = "";
      const runner = new CodexWorkspaceRunner(workspace, {
        model: "account-model",
        runCli: async ({ prompt, outputPath }) => {
          observedPrompt = prompt;
          await writeFile(outputPath, JSON.stringify({
            summary: "Unsafe",
            verification: "Not run",
            writes: [{ path: "../escape.txt", content: "escape" }],
          }), "utf8");
        },
      });
      await expect(runner.run("owner-a", {
        objective: "Change source",
        path: "repo",
        timeoutSeconds: 90,
      })).rejects.toThrow(/escaping/u);
      expect(observedPrompt).toContain("source.ts");
      expect(observedPrompt).not.toContain("do-not-send");
      expect(observedPrompt).not.toContain(credentialLike);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
