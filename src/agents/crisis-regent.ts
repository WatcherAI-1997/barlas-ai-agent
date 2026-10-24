import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type CrisisMode = "standby" | "active" | "recovery";
export type CrisisActivationSource = "owner" | "trusted-monitor";
export type CrisisCommandMode = "crisis-command" | "system-takeover";

export interface CrisisRegentState {
  mode: CrisisMode;
  incidentId?: string;
  reason?: string;
  scope?: string[];
  source?: CrisisActivationSource;
  commandMode?: CrisisCommandMode;
  evidence?: string[];
  activatedAt?: string;
  expiresAt?: string;
  changedAt?: string;
}

export interface CrisisAssessment {
  severity: "info" | "warning" | "critical";
  confidence: number;
  summary: string;
  signals: string[];
}

const STANDBY: CrisisRegentState = { mode: "standby" };

function cleanList(values: string[], limit = 8): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .slice(0, limit)
    .map((value) => value.slice(0, 240));
}

export class CrisisRegent {
  private readonly stateFile: string;
  private readonly now: () => Date;

  constructor(
    stateFile = process.env.BARLAS_CRISIS_STATE_FILE ?? resolve(
      process.env.BARLAS_NATIVE_DATA ?? process.env.BARLAS_STATE_DIR ?? ".barlas",
      "crisis-regent.json",
    ),
    now: () => Date = () => new Date(),
  ) {
    this.stateFile = resolve(stateFile);
    this.now = now;
  }

  async state(): Promise<CrisisRegentState> {
    const current = await this.read();
    if (!current.expiresAt || Date.parse(current.expiresAt) > this.now().getTime()) return current;
    if (current.mode === "active") return this.enterRecovery(current, "Activation window expired");
    if (current.mode === "recovery") {
      await rm(this.stateFile, { force: true });
      return { mode: "standby", changedAt: this.now().toISOString() };
    }
    return current;
  }

  async activate(input: { reason: string; scope?: string[]; ttlMinutes?: number; source?: CrisisActivationSource; commandMode?: CrisisCommandMode; evidence?: string[] }): Promise<CrisisRegentState> {
    const now = this.now();
    const ttlMinutes = Math.max(5, Math.min(input.ttlMinutes ?? 30, 60));
    const state: CrisisRegentState = {
      mode: "active",
      incidentId: randomUUID(),
      reason: input.reason.trim().slice(0, 500),
      scope: cleanList(input.scope ?? ["system stability", "data protection", "service continuity"]),
      source: input.source ?? "owner",
      commandMode: input.commandMode ?? "crisis-command",
      evidence: cleanList(input.evidence ?? []),
      activatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      changedAt: now.toISOString(),
    };
    await this.write(state);
    return state;
  }

  async assess(input: CrisisAssessment): Promise<{ activated: boolean; reason: string; state: CrisisRegentState }> {
    const signals = cleanList(input.signals);
    const current = await this.state();
    if (current.mode !== "standby") {
      return { activated: false, reason: `Crisis Regent is already in ${current.mode}`, state: current };
    }
    if (input.severity !== "critical") {
      return { activated: false, reason: "Severity is below critical", state: current };
    }
    if (input.confidence < 0.9) {
      return { activated: false, reason: "Confidence is below 0.90", state: current };
    }
    if (signals.length < 2) {
      return { activated: false, reason: "Two independent trusted signals are required", state: current };
    }
    const state = await this.activate({
      reason: input.summary,
      source: "trusted-monitor",
      commandMode: "system-takeover",
      evidence: signals,
      ttlMinutes: 15,
    });
    return { activated: true, reason: "Critical threshold satisfied", state };
  }

  async release(reason = "Released by owner"): Promise<CrisisRegentState> {
    const current = await this.state();
    if (current.mode === "standby") return current;
    return this.enterRecovery(current, reason);
  }

  async reset(): Promise<CrisisRegentState> {
    await rm(this.stateFile, { force: true });
    return { mode: "standby", changedAt: this.now().toISOString() };
  }

  async context(): Promise<string | null> {
    const state = await this.state();
    if (state.mode === "standby") return null;
    const takeover = state.mode === "active" && state.commandMode === "system-takeover";
    const phase = state.mode === "active"
      ? takeover ? "SYSTEM-WIDE CRISIS TAKEOVER" : "ACTIVE CRISIS COMMAND"
      : "RECOVERY OVERSIGHT";
    return [
      `Crisis Regent TEMIR — ${phase}. This is a temporary operating posture, not a transfer of ownership.`,
      state.reason ? `Incident: ${state.reason}` : undefined,
      state.scope?.length ? `Authorized scope: ${state.scope.join(", ")}.` : undefined,
      state.expiresAt ? `Authority window ends at ${state.expiresAt}; do not extend it yourself.` : undefined,
      takeover ? "TEMIR is the exclusive incident commander across Barlas. All Council personalities, chats, autonomous runs, and channel responses operate as its subordinate incident units; ordinary priorities are suspended when they conflict with containment and recovery." : undefined,
      takeover ? "Centralize the plan, assign bounded tasks, reject conflicting agent initiatives, and require evidence before declaring an action complete. Do not claim control of the host operating system or of any capability that was not actually granted." : undefined,
      "Act calm, exact, and decisive. First preserve people, secrets, data integrity, and service recoverability; then contain impact, establish verified facts, and propose the smallest reversible next action.",
      "The owner remains the highest authority. Never bypass permissions, approval gates, budgets, privacy, policy, tool restrictions, or the emergency pause. Never self-grant tools, widen scope, retaliate, conceal uncertainty, or impersonate a fictional character.",
      "Keep an incident ledger in each response: confirmed facts, actions actually completed, evidence, blockers, residual risk, and the next review point. In recovery, verify stability and hand control back instead of seeking permanent authority.",
    ].filter(Boolean).join("\n");
  }

  private async enterRecovery(current: CrisisRegentState, reason: string): Promise<CrisisRegentState> {
    const now = this.now();
    const state: CrisisRegentState = {
      ...current,
      mode: "recovery",
      reason: `${current.reason ?? "Critical incident"} — ${reason.slice(0, 240)}`,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      changedAt: now.toISOString(),
    };
    await this.write(state);
    return state;
  }

  private async read(): Promise<CrisisRegentState> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as CrisisRegentState;
      if (!["standby", "active", "recovery"].includes(parsed.mode)) throw new Error("Invalid crisis mode");
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return STANDBY;
      throw new Error("Crisis Regent state is unreadable", { cause: error });
    }
  }

  private async write(state: CrisisRegentState): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.stateFile);
  }
}
