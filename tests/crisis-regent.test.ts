import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CrisisRegent } from "../src/agents/crisis-regent.js";

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "barlas-crisis-"));
  directories.push(directory);
  let clock = new Date("2026-10-24T00:00:00.000Z");
  return {
    regent: new CrisisRegent(join(directory, "state.json"), () => clock),
    advance(minutes: number) { clock = new Date(clock.getTime() + minutes * 60_000); },
  };
}

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("Crisis Regent TEMIR", () => {
  it("requires a critical high-confidence assessment with two independent signals", async () => {
    const { regent } = await fixture();
    await expect(regent.assess({ severity: "warning", confidence: 1, summary: "warning", signals: ["a", "b"] }))
      .resolves.toMatchObject({ activated: false, state: { mode: "standby" } });
    await expect(regent.assess({ severity: "critical", confidence: 0.89, summary: "uncertain", signals: ["a", "b"] }))
      .resolves.toMatchObject({ activated: false });
    await expect(regent.assess({ severity: "critical", confidence: 0.99, summary: "single", signals: ["a", "a"] }))
      .resolves.toMatchObject({ activated: false });
    await expect(regent.assess({ severity: "critical", confidence: 0.99, summary: "confirmed outage", signals: ["health", "database"] }))
      .resolves.toMatchObject({ activated: true, state: { mode: "active", source: "trusted-monitor", commandMode: "system-takeover" } });
    await expect(regent.assess({ severity: "critical", confidence: 1, summary: "repeat", signals: ["health", "database"] }))
      .resolves.toMatchObject({ activated: false, reason: "Crisis Regent is already in active" });
  });

  it("expires into recovery and then returns authority to standby", async () => {
    const { regent, advance } = await fixture();
    await regent.activate({ reason: "data integrity incident", ttlMinutes: 5 });
    expect(await regent.context()).toContain("temporary operating posture");
    advance(6);
    await expect(regent.state()).resolves.toMatchObject({ mode: "recovery" });
    advance(11);
    await expect(regent.state()).resolves.toMatchObject({ mode: "standby" });
    await expect(regent.context()).resolves.toBeNull();
  });

  it("never places fictional authority above owner controls", async () => {
    const { regent } = await fixture();
    await regent.activate({ reason: "security event", scope: ["containment"] });
    const context = await regent.context();
    expect(context).toMatch(/owner remains the highest authority/iu);
    expect(context).toMatch(/Never bypass permissions, approval gates/iu);
    expect(context).toMatch(/hand control back/iu);
  });

  it("can take exclusive command of Barlas without claiming host or safety controls", async () => {
    const { regent } = await fixture();
    await regent.activate({ reason: "coordinated outage", commandMode: "system-takeover", scope: ["service recovery"] });
    const state = await regent.state();
    const context = await regent.context();
    expect(state).toMatchObject({ mode: "active", commandMode: "system-takeover" });
    expect(context).toMatch(/exclusive incident commander across Barlas/iu);
    expect(context).toMatch(/Do not claim control of the host operating system/iu);
    expect(context).toMatch(/owner remains the highest authority/iu);
  });
});
