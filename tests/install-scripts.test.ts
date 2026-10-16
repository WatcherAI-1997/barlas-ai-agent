import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("production installer", () => {
  it("has valid Bash syntax and documents both entry points", () => {
    expect(spawnSync("bash", ["-n", "install.sh", "scripts/doctor.sh", "scripts/dashboard-url.sh"], { cwd: root }).status).toBe(0);
    expect(spawnSync("bash", ["install.sh", "--help"], { cwd: root, encoding: "utf8" }).stdout).toContain("--prepare-only");
    expect(spawnSync("bash", ["scripts/doctor.sh", "--help"], { cwd: root, encoding: "utf8" }).stdout).toContain("--require-running");
  });

  it("prepares a protected config without printing supplied secrets", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "barlas-installer-"));
    const fakeBin = join(temporary, "bin");
    const envFile = join(temporary, "production.env");
    await mkdir(fakeBin);
    const fakeDocker = join(fakeBin, "docker");
    await writeFile(fakeDocker, "#!/bin/sh\ncase \"$1 $2\" in \"compose version\") exit 0;; \"compose -f\") exit 0;; info*) exit 1;; esac\nexit 0\n", "utf8");
    await chmod(fakeDocker, 0o755);

    const result = spawnSync("bash", ["install.sh", "--non-interactive", "--prepare-only", "--env-file", envFile], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        BARLAS_DOMAIN: "agent.barlas.test",
        OWNER_EMAIL: "owner@barlas.test",
        OWNER_LANGUAGE: "mn",
        MODEL_NAME: "fast-test-model",
        DEEP_MODEL_NAME: "deep-test-model",
        MODEL_API_KEY: "installer-$ecret-#-model-key",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("●       ●");
    expect(result.stdout).toContain("    ●");
    expect(result.stdout).toContain("B A R L A S   A I   A G E N T");
    expect(result.stdout).toContain("THINK AHEAD. ACT BEYOND.");
    expect(result.stdout).toContain("Secure Production Installer");
    expect(`${result.stdout}${result.stderr}`).not.toContain("installer-$ecret");
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    const environment = await readFile(envFile, "utf8");
    expect(environment).toContain("BARLAS_DOMAIN='agent.barlas.test'");
    expect(environment).toContain("OWNER_LANGUAGE='mn'");
    expect(environment).toMatch(/BARLAS_GATEWAY_TOKEN='[a-f0-9]{64}'/u);
    expect(environment).not.toContain("OWNER_PASSWORD");
    expect(environment).not.toContain("replace-with-");
    const dashboard = spawnSync("bash", ["scripts/dashboard-url.sh", "--env-file", envFile], { cwd: root, encoding: "utf8" });
    expect(dashboard.status, dashboard.stderr).toBe(0);
    expect(dashboard.stdout).toMatch(/^https:\/\/agent\.barlas\.test:18443\/#token=[a-f0-9]{64}\n$/u);
    await rm(temporary, { recursive: true, force: true });
  });
});
