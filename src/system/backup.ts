import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";
import { z } from "zod";

const manifestSchema = z.object({
  format: z.literal("barlas-state-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  files: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })),
}).strict();
const MAX_BACKUP_FILE_BYTES = 2_000_000_000;
const MAX_BACKUP_TOTAL_BYTES = 10_000_000_000;

export interface BackupSummary { archive: string; files: number; bytes: number; createdAt: string }

function digest(content: Buffer): string { return createHash("sha256").update(content).digest("hex"); }

function safeArchivePath(path: string): boolean {
  return !path.startsWith("/") && !path.startsWith("\\") && !/^[A-Za-z]:/u.test(path)
    && path.split(/[\\/]/u).every((part) => part !== "" && part !== "." && part !== "..");
}

async function collect(root: string, current = root): Promise<Array<{ path: string; content: Buffer }>> {
  const files: Array<{ path: string; content: Buffer }> = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) files.push(...await collect(root, absolute));
    else if (info.isFile()) {
      const path = relative(root, absolute).split(sep).join("/");
      if (!safeArchivePath(path)) throw new Error(`Unsafe backup path: ${path}`);
      files.push({ path, content: await readFile(absolute) });
    }
  }
  return files;
}

export function defaultStateDirectory(): string {
  if (process.env.BARLAS_NATIVE_DATA) return resolve(process.env.BARLAS_NATIVE_DATA);
  if (process.env.BARLAS_STATE_DIR) return resolve(process.env.BARLAS_STATE_DIR);
  if (process.env.LOCALAPPDATA) return resolve(process.env.LOCALAPPDATA, "Barlas", "data");
  return resolve(process.env.HOME ?? process.cwd(), ".barlas");
}

export async function createStateBackup(source: string, archive: string): Promise<BackupSummary> {
  const sourceRoot = resolve(source);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("Backup source must be a directory");
  const files = await collect(sourceRoot);
  const zip = new JSZip();
  const entries = files.map(({ path, content }) => ({ path, bytes: content.byteLength, sha256: digest(content) }));
  for (const file of files) zip.file(`state/${file.path}`, file.content);
  const createdAt = new Date().toISOString();
  zip.file("manifest.json", `${JSON.stringify({ format: "barlas-state-backup", version: 1, createdAt, files: entries }, null, 2)}\n`);
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const destination = resolve(archive);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, destination);
  return { archive: destination, files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), createdAt };
}

async function loadVerified(archive: string): Promise<{ zip: JSZip; manifest: z.infer<typeof manifestSchema> }> {
  const zip = await JSZip.loadAsync(await readFile(resolve(archive)), { checkCRC32: true });
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Backup manifest is missing");
  const manifest = manifestSchema.parse(JSON.parse(await manifestFile.async("string")));
  const declaredBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  if (manifest.files.some((file) => file.bytes > MAX_BACKUP_FILE_BYTES) || declaredBytes > MAX_BACKUP_TOTAL_BYTES) {
    throw new Error("Backup exceeds the safe extraction limit");
  }
  const expected = new Set(["manifest.json", ...manifest.files.map((file) => `state/${file.path}`)]);
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name]!.dir && !expected.has(name)) throw new Error(`Unexpected backup entry: ${name}`);
  }
  for (const file of manifest.files) {
    if (!safeArchivePath(file.path)) throw new Error(`Unsafe backup path: ${file.path}`);
    const entry = zip.file(`state/${file.path}`);
    if (!entry) throw new Error(`Backup entry is missing: ${file.path}`);
    const metadata = entry as unknown as { _data?: { uncompressedSize?: number } };
    if ((metadata._data?.uncompressedSize ?? file.bytes) !== file.bytes) throw new Error(`Backup entry size is inconsistent: ${file.path}`);
    const content = await entry.async("nodebuffer");
    if (content.byteLength !== file.bytes || digest(content) !== file.sha256) throw new Error(`Backup entry failed verification: ${file.path}`);
  }
  return { zip, manifest };
}

export async function verifyStateBackup(archive: string): Promise<BackupSummary> {
  const { manifest } = await loadVerified(archive);
  return { archive: resolve(archive), files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), createdAt: manifest.createdAt };
}

export async function restoreStateBackup(archive: string, target: string, force = false): Promise<BackupSummary> {
  if (!force) throw new Error("Restore overwrites matching state files; repeat with --force");
  const { zip, manifest } = await loadVerified(archive);
  const targetRoot = resolve(target);
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const destination = resolve(targetRoot, file.path);
    if (destination !== targetRoot && !destination.startsWith(`${targetRoot}${sep}`)) throw new Error(`Backup path escapes target: ${file.path}`);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, await zip.file(`state/${file.path}`)!.async("nodebuffer"), { mode: 0o600 });
  }
  return { archive: resolve(archive), files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), createdAt: manifest.createdAt };
}

export function defaultBackupName(now = new Date()): string {
  return resolve(`barlas-backup-${now.toISOString().replace(/[:.]/gu, "-")}.zip`);
}
