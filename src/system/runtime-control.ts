import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface RuntimeControlState {
  paused: boolean;
  reason?: string;
  changedAt?: string;
}

export class RuntimeControl {
  private readonly stateFile: string;

  constructor(stateFile = process.env.BARLAS_RUNTIME_CONTROL_FILE ?? resolve(
    process.env.BARLAS_NATIVE_DATA ?? process.env.BARLAS_STATE_DIR ?? ".barlas",
    "runtime-control.json",
  )) {
    this.stateFile = resolve(stateFile);
  }

  async state(): Promise<RuntimeControlState> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as RuntimeControlState;
      return parsed.paused === true
        ? { paused: true, ...(parsed.reason ? { reason: parsed.reason } : {}), ...(parsed.changedAt ? { changedAt: parsed.changedAt } : {}) }
        : { paused: false, ...(parsed.changedAt ? { changedAt: parsed.changedAt } : {}) };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { paused: false };
      throw new Error("Runtime control state is unreadable", { cause: error });
    }
  }

  async isPaused(): Promise<boolean> {
    return (await this.state()).paused;
  }

  async pause(reason = "Paused by owner"): Promise<RuntimeControlState> {
    const state = { paused: true, reason: reason.slice(0, 500), changedAt: new Date().toISOString() } satisfies RuntimeControlState;
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.stateFile);
    return state;
  }

  async resume(): Promise<RuntimeControlState> {
    const changedAt = new Date().toISOString();
    await rm(this.stateFile, { force: true });
    return { paused: false, changedAt };
  }
}
