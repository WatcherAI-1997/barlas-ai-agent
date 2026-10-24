import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ClaudeCodeWorkspaceRunner } from "../src/tools/claude-code-runner.js";
import { FileWorkspace } from "../src/tools/file-workspace.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

describe("approval-gated Claude Code workspace runner", () => {
  it("applies only validated structured writes inside the owning workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-claude-test-"));
    try {
      const workspace = new FileWorkspace(root);
      await workspace.write("owner-a", "repo/input.ts", "export const before = true;\n");
      const calls: Array<{ prompt: string; cwd: string; model: string; timeoutSeconds: number }> = [];
      const runner = new ClaudeCodeWorkspaceRunner(workspace, {
        model: "sonnet",
        runCli: async ({ prompt, cwd, model, timeoutSeconds, outputPath }) => {
          calls.push({ prompt, cwd, model, timeoutSeconds });
          await writeFile(outputPath, JSON.stringify({
            summary: "Added output.",
            verification: "Runtime verification was not run.",
            writes: [{ path: "output.ts", content: "export const after = true;\n" }],
          }), "utf8");
        },
      });

      const result = await runner.run("owner-a", { objective: "Add output", path: "repo", timeoutSeconds: 90 });

      expect(result).toMatchObject({ runner: "claude-code", model: "sonnet", path: "repo", changedFiles: ["output.ts"] });
      expect(calls[0]?.prompt).toContain("no tools, shell");
      expect(calls[0]?.prompt).toContain("input.ts");
      expect(calls[0]?.cwd).not.toContain("owner-a");
      await expect(workspace.read("owner-a", "repo/output.ts")).resolves.toMatchObject({ content: "export const after = true;\n" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("registers the external-risk tool only when configured", () => {
    expect(createBuiltinToolRegistry().list().some((tool) => tool.name === "runner.claude-code.execute")).toBe(false);
    const registry = createBuiltinToolRegistry({ claudeCodeRunner: { run: vi.fn() } });
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: "runner.claude-code.execute", risk: "external" }));
  });

  it("filters secrets and rejects escaping writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-claude-boundary-"));
    try {
      const workspace = new FileWorkspace(root);
      await workspace.write("owner-a", "repo/source.ts", "export const value = 1;\n");
      await workspace.write("owner-a", "repo/.env", "PRIVATE_TOKEN=do-not-send\n");
      let prompt = "";
      const runner = new ClaudeCodeWorkspaceRunner(workspace, {
        model: "sonnet",
        runCli: async (input) => {
          prompt = input.prompt;
          await writeFile(input.outputPath, JSON.stringify({
            summary: "Unsafe", verification: "Not run", writes: [{ path: "../escape.ts", content: "escape" }],
          }), "utf8");
        },
      });
      await expect(runner.run("owner-a", { objective: "Change source", path: "repo", timeoutSeconds: 90 }))
        .rejects.toThrow(/escaping/u);
      expect(prompt).toContain("source.ts");
      expect(prompt).not.toContain("do-not-send");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
