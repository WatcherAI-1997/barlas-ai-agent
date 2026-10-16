import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { FileWorkspace } from "../src/tools/file-workspace.js";

const temporaryDirectories: string[] = [];

async function workspace(): Promise<FileWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "barlas-workspace-test-"));
  temporaryDirectories.push(root);
  return new FileWorkspace(root);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Barlas AI Agent file workspace", () => {
  it("isolates files by user and supports bounded reads and writes", async () => {
    const files = await workspace();
    await files.write("user-a", "notes/plan.txt", "private plan");

    await expect(files.read("user-a", "notes/plan.txt")).resolves.toEqual({
      path: "notes/plan.txt",
      content: "private plan",
    });
    await expect(files.read("user-b", "notes/plan.txt")).rejects.toThrow();
    await expect(files.list("user-a", "notes")).resolves.toEqual([
      { path: "notes/plan.txt", type: "file" },
    ]);
  });

  it("rejects traversal and symlink escapes", async () => {
    const files = await workspace();
    await files.write("user-a", "safe.txt", "safe");
    await expect(files.read("user-a", "../../etc/passwd")).rejects.toThrow("escapes");

    const root = temporaryDirectories.at(-1);
    if (!root) throw new Error("Missing test root");
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root));
    const userRoot = join(root, entries[0] ?? "");
    await mkdir(join(userRoot, "links"));
    await symlink("/etc", join(userRoot, "links", "outside"));
    await expect(files.read("user-a", "links/outside/passwd")).rejects.toThrow("escapes");
  });

  it("stores approved writes with restrictive file permissions", async () => {
    const files = await workspace();
    const output = await files.write("user-a", "result.txt", "hello");
    expect(output).toEqual({ path: "result.txt", bytes: 5 });

    const root = temporaryDirectories.at(-1);
    if (!root) throw new Error("Missing test root");
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root));
    await expect(readFile(join(root, entries[0] ?? "", "result.txt"), "utf8")).resolves.toBe("hello");
  });

  it("requires explicit overwrite for direct uploads", async () => {
    const files = await workspace();
    await expect(files.writeUpload("user-a", "projects/input.txt", Buffer.from("first"))).resolves.toEqual({ path: "projects/input.txt", bytes: 5 });
    await expect(files.writeUpload("user-a", "projects/input.txt", Buffer.from("second"))).rejects.toMatchObject({ code: "EEXIST" });
    await expect(files.writeUpload("user-a", "projects/input.txt", Buffer.from("second"), true)).resolves.toEqual({ path: "projects/input.txt", bytes: 6 });
    await expect(files.readBuffer("user-a", "projects/input.txt")).resolves.toMatchObject({ content: Buffer.from("second") });
  });

  it("streams files larger than the legacy 10 MB buffer boundary", async () => {
    const files = await workspace();
    const chunks = Array.from({ length: 12 }, () => Buffer.alloc(1_000_000, 0x61));
    await expect(files.writeUploadStream(
      "user-a",
      "large/archive.bin",
      Readable.from(chunks),
      20_000_000,
    )).resolves.toEqual({ path: "large/archive.bin", bytes: 12_000_000 });

    const stored = await files.streamForRead("user-a", "large/archive.bin", 20_000_000);
    let bytes = 0;
    for await (const chunk of stored.stream) bytes += Buffer.byteLength(chunk);
    expect(bytes).toBe(12_000_000);
  });

  it("does not replace an existing file when a streamed upload exceeds its boundary", async () => {
    const files = await workspace();
    await files.writeUpload("user-a", "large/result.bin", Buffer.from("original"));

    await expect(files.writeUploadStream(
      "user-a",
      "large/result.bin",
      Readable.from([Buffer.alloc(6), Buffer.alloc(6)]),
      10,
      true,
    )).rejects.toThrow("configured workspace limit");
    await expect(files.readBuffer("user-a", "large/result.bin")).resolves.toMatchObject({
      content: Buffer.from("original"),
    });
  });
});
