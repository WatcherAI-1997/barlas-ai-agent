import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createStateBackup, restoreStateBackup, verifyStateBackup } from "../src/system/backup.js";
import { RuntimeControl } from "../src/system/runtime-control.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "barlas-system-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("state backup", () => {
  it("creates, verifies, and restores a checksummed archive", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source");
    const archive = join(root, "backup.zip");
    const target = join(root, "restored");
    await mkdir(join(source, "database"), { recursive: true });
    await writeFile(join(source, "database", "state.bin"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(source, "settings.json"), "{\"ok\":true}\n", "utf8");

    await expect(createStateBackup(source, archive)).resolves.toMatchObject({ files: 2 });
    await expect(verifyStateBackup(archive)).resolves.toMatchObject({ files: 2 });
    await expect(restoreStateBackup(archive, target)).rejects.toThrow(/--force/u);
    await expect(restoreStateBackup(archive, target, true)).resolves.toMatchObject({ files: 2 });
    expect(await readFile(join(target, "database", "state.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
  });
});

describe("runtime control", () => {
  it("persists emergency pause state until resumed", async () => {
    const root = await temporaryDirectory();
    const control = new RuntimeControl(join(root, "runtime-control.json"));
    await expect(control.state()).resolves.toEqual({ paused: false });
    await expect(control.pause("maintenance")).resolves.toMatchObject({ paused: true, reason: "maintenance" });
    await expect(new RuntimeControl(join(root, "runtime-control.json")).isPaused()).resolves.toBe(true);
    await expect(control.resume()).resolves.toMatchObject({ paused: false });
    await expect(control.isPaused()).resolves.toBe(false);
  });
});
