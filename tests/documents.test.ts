import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentWriter } from "../src/tools/documents.js";
import { FileWorkspace } from "../src/tools/file-workspace.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("document writer", () => {
  it("creates an escaped CSV inside the owning user's workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const workspace = new FileWorkspace(root);
    const writer = new DocumentWriter(workspace);
    const result = await writer.create({
      userId: "user-a",
      path: "reports/data.csv",
      format: "csv",
      rows: [["name", "note"], ["Barlas", "one, \"two\""]],
    });

    expect(result).toMatchObject({ path: "reports/data.csv", format: "csv" });
    const saved = await workspace.pathForRead("user-a", "reports/data.csv");
    expect(await readFile(saved.absolutePath, "utf8")).toBe('name,note\r\nBarlas,"one, ""two"""\r\n');
    await expect(workspace.read("user-b", "reports/data.csv")).rejects.toThrow();
  });

  it("requires a matching safe extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const writer = new DocumentWriter(new FileWorkspace(root));
    await expect(writer.create({
      userId: "user-a",
      path: "report.html",
      format: "markdown",
      content: "# Report",
    })).rejects.toThrow(/\.md/u);
  });
});
