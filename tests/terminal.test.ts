import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileWorkspace } from "../src/tools/file-workspace.js";
import { RestrictedTerminal } from "../src/tools/terminal.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Barlas AI Agent restricted terminal", () => {
  it("runs only a predefined inspection over a resolved workspace file", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-terminal-test-"));
    roots.push(root);
    const workspace = new FileWorkspace(root);
    await workspace.write("user-1", "notes.txt", "one two\nthree\n");
    const terminal = new RestrictedTerminal(workspace);

    const result = await terminal.inspect({
      userId: "user-1",
      operation: "head",
      path: "notes.txt",
      lines: 1,
    });
    expect(result).toMatchObject({ operation: "head", path: "notes.txt", stdout: "one two\n" });
  });

  it("cannot inspect files outside the user workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-terminal-test-"));
    roots.push(root);
    const terminal = new RestrictedTerminal(new FileWorkspace(root));
    await expect(terminal.inspect({
      userId: "user-1",
      operation: "head",
      path: "/etc/passwd",
    })).rejects.toThrow("relative");
  });
});
