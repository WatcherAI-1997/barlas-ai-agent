import { request } from "node:http";

export type SandboxCommand = "python" | "node" | "git" | "npm";

export interface SandboxRunResult {
  command: SandboxCommand;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
}

export class CodeSandboxClient {
  constructor(
    private readonly socketPath: string,
    private readonly token: string,
  ) {}

  run(input: {
    userId: string;
    command: SandboxCommand;
    args: string[];
    cwd?: string;
    timeoutSeconds?: number;
  }): Promise<SandboxRunResult> {
    const body = JSON.stringify(input);
    return new Promise((resolve, reject) => {
      const call = request({
        socketPath: this.socketPath,
        path: "/run",
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 70_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 250_000) {
            response.destroy(new Error("Sandbox response exceeds 250 KB"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SandboxRunResult & { error?: string };
            if ((response.statusCode ?? 500) >= 400) reject(new Error(payload.error ?? "Sandbox request failed"));
            else resolve(payload);
          } catch (error) {
            reject(error);
          }
        });
      });
      call.on("timeout", () => call.destroy(new Error("Sandbox request timed out")));
      call.on("error", reject);
      call.end(body);
    });
  }
}
