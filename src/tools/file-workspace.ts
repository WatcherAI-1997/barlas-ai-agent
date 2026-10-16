import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX_READ_BYTES = 1_000_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_DOCUMENT_BYTES = 10_000_000;

export class FileWorkspace {
  constructor(private readonly root: string) {}

  async list(userId: string, path = "."): Promise<Array<{ path: string; type: "file" | "directory" }>> {
    const { userRoot, target } = await this.resolveExisting(userId, path);
    const entries = await readdir(target, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        path: relative(userRoot, resolve(target, entry.name)) || ".",
        type: entry.isDirectory() ? "directory" : "file",
      }));
  }

  async read(userId: string, path: string): Promise<{ path: string; content: string }> {
    const { userRoot, target } = await this.resolveExisting(userId, path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular files can be read");
    if (info.size > MAX_READ_BYTES) throw new Error("File exceeds the 1 MB read limit");
    return { path: relative(userRoot, target), content: await readFile(target, "utf8") };
  }

  async pathForRead(userId: string, path: string): Promise<{
    userRoot: string;
    absolutePath: string;
    relativePath: string;
  }> {
    const { userRoot, target } = await this.resolveExisting(userId, path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular files can be inspected");
    if (info.size > MAX_READ_BYTES) throw new Error("File exceeds the 1 MB inspection limit");
    return { userRoot, absolutePath: target, relativePath: relative(userRoot, target) };
  }

  async readBuffer(userId: string, path: string, maxBytes = MAX_DOCUMENT_BYTES): Promise<{
    path: string;
    content: Buffer;
  }> {
    const { userRoot, target } = await this.resolveExisting(userId, path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular files can be read");
    if (info.size > maxBytes) throw new Error(`File exceeds the ${Math.floor(maxBytes / 1_000_000)} MB document limit`);
    return { path: relative(userRoot, target), content: await readFile(target) };
  }

  async write(userId: string, path: string, content: string): Promise<{ path: string; bytes: number }> {
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_WRITE_BYTES) throw new Error("Content exceeds the 1 MB write limit");
    return this.writeData(userId, path, Buffer.from(content, "utf8"));
  }

  async writeBuffer(userId: string, path: string, content: Buffer): Promise<{ path: string; bytes: number }> {
    if (content.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the 10 MB write limit");
    return this.writeData(userId, path, content);
  }

  async writeUpload(userId: string, path: string, content: Buffer, overwrite = false): Promise<{ path: string; bytes: number }> {
    if (content.byteLength === 0) throw new Error("Uploaded file is empty");
    if (content.byteLength > MAX_DOCUMENT_BYTES) throw new Error("File exceeds the 10 MB upload limit");
    return this.writeData(userId, path, content, overwrite);
  }

  private async writeData(userId: string, path: string, content: Buffer, overwrite = true): Promise<{ path: string; bytes: number }> {
    const userRoot = await this.ensureUserRoot(userId);
    const target = this.resolveRelative(userRoot, path);
    await this.ensureSafeParent(userRoot, dirname(target));

    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Target must be a regular file");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW |
        (overwrite ? constants.O_TRUNC : constants.O_EXCL),
      0o600,
    );
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return { path: relative(userRoot, target), bytes: content.byteLength };
  }

  private async resolveExisting(userId: string, path: string) {
    const userRoot = await this.ensureUserRoot(userId);
    const requested = this.resolveRelative(userRoot, path);
    const target = await realpath(requested);
    this.assertInside(userRoot, target);
    return { userRoot, target };
  }

  private async ensureUserRoot(userId: string): Promise<string> {
    const key = createHash("sha256").update(userId).digest("hex");
    const configuredRoot = resolve(this.root);
    await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
    const userRoot = resolve(configuredRoot, key);
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    return realpath(userRoot);
  }

  private resolveRelative(userRoot: string, path: string): string {
    if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Path must be relative");
    const target = resolve(userRoot, path);
    this.assertInside(userRoot, target);
    return target;
  }

  private assertInside(userRoot: string, target: string): void {
    const child = relative(userRoot, target);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error("Path escapes the user workspace");
    }
  }

  private async ensureSafeParent(userRoot: string, parent: string): Promise<void> {
    this.assertInside(userRoot, parent);
    const child = relative(userRoot, parent);
    let current = userRoot;
    for (const segment of child.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe workspace path");
      } catch (error) {
        if (!isMissing(error)) throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
    this.assertInside(userRoot, await realpath(parent));
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
