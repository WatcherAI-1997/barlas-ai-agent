import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { FileWorkspace } from "./file-workspace.js";

const executeFile = promisify(execFile);

export type InspectOperation = "sha256" | "word_count" | "head" | "tail";

export class RestrictedTerminal {
  constructor(private readonly workspace: FileWorkspace) {}

  async inspect(input: {
    userId: string;
    operation: InspectOperation;
    path: string;
    lines?: number;
  }): Promise<{ operation: InspectOperation; path: string; stdout: string }> {
    const target = await this.workspace.pathForRead(input.userId, input.path);
    const command = this.command(input.operation, target.absolutePath, input.lines);
    const { stdout } = await executeFile(command.file, command.args, {
      cwd: target.userRoot,
      timeout: 5_000,
      maxBuffer: 128_000,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    });
    return { operation: input.operation, path: target.relativePath, stdout: stdout.slice(0, 128_000) };
  }

  private command(operation: InspectOperation, path: string, lines = 20) {
    switch (operation) {
      case "sha256": return { file: "sha256sum", args: [path] };
      case "word_count": return { file: "wc", args: ["-l", "-w", "-c", path] };
      case "head": return { file: "head", args: ["-n", String(lines), path] };
      case "tail": return { file: "tail", args: ["-n", String(lines), path] };
    }
  }
}
