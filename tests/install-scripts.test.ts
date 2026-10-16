import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("production installer", () => {
  it("has valid Bash syntax and documents both entry points", () => {
    expect(spawnSync("bash", ["-n", "install.sh", "barlas", "scripts/doctor.sh", "scripts/dashboard-url.sh", "scripts/update.sh"], { cwd: root }).status).toBe(0);
    expect(spawnSync("sh", ["-n", "deploy/backup-loop.sh", "deploy/backup-now.sh"], { cwd: root }).status).toBe(0);
    expect(spawnSync("bash", ["install.sh", "--help"], { cwd: root, encoding: "utf8" }).stdout).toContain("--prepare-only");
    expect(spawnSync("bash", ["scripts/doctor.sh", "--help"], { cwd: root, encoding: "utf8" }).stdout).toContain("--require-running");
    expect(spawnSync("bash", ["scripts/update.sh", "--help"], { cwd: root, encoding: "utf8" }).stdout).toContain("--rollback");
  });

  it("ships a native Windows local installer and companion commands", async () => {
    const bootstrap = await readFile(join(root, "install-windows.ps1"), "utf8");
    const installer = await readFile(join(root, "install-native.ps1"), "utf8");
    const doctor = await readFile(join(root, "scripts", "doctor-native.ps1"), "utf8");
    const dashboard = await readFile(join(root, "scripts", "dashboard-url.ps1"), "utf8");
    const cli = await readFile(join(root, "barlas.ps1"), "utf8");

    for (const required of [
      'BARLAS_INSTALL_MODE = "native"',
      "Protect-SecretFile",
      "RandomNumberGenerator",
      'BROWSER_WS_ENDPOINT = "local://chromium"',
      "scripts\\start-native.ps1",
    ]) expect(installer).toContain(required);
    expect(installer).not.toContain("Docker");
    expect(doctor).toContain("Docker and WSL are not used");
    expect(dashboard).toContain("#token=$Token");
    expect(cli).toContain("dist/src/cli.js");
    for (const required of [
      "archive/refs/heads/main.zip",
      'Join-Path $env:LOCALAPPDATA "Barlas"',
      "native.env",
      "barlas.cmd",
      'Start-Process ([string]$DashboardUrl).Trim()',
      "Show-PixelBanner",
      'Write-Host "  ●   ●  "',
      'Write-Host "    ●    "',
      "[$Number/5]",
      "install.log",
      "AI AGENT COMMANDS",
      'barlas ask "your task"',
      "barlas approvals",
      "barlas approve ID",
      "barlas gateway status",
      "barlas gateway restart",
      "nodejs.org/dist",
      "playwright-core.cmd",
      "install-native.ps1",
      "no Docker or WSL required",
    ]) expect(bootstrap).toContain(required);
    expect(bootstrap).not.toContain("docker info");
    expect(bootstrap).not.toContain("Docker.DockerDesktop");
    expect(bootstrap).not.toContain('"BARLAS".ToCharArray()');
    expect(bootstrap).not.toContain("gh auth");
    expect(bootstrap).toContain('$ErrorActionPreference = "Continue"');
    expect(bootstrap).toContain("$Code");
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
    expect(result.stdout).toContain("⬤  ⬤");
    expect(result.stdout).toContain("Barlas");
    expect(result.stdout).toContain("AI AGENT");
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

  it("prepares a localhost installation without requiring a domain", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "barlas-local-installer-"));
    const fakeBin = join(temporary, "bin");
    const envFile = join(temporary, "local.env");
    await mkdir(fakeBin);
    const fakeDocker = join(fakeBin, "docker");
    await writeFile(fakeDocker, "#!/bin/sh\ncase \"$1 $2\" in \"compose version\") exit 0;; \"compose -f\") exit 0;; info*) exit 1;; esac\nexit 0\n", "utf8");
    await chmod(fakeDocker, 0o755);

    const result = spawnSync("bash", ["install.sh", "--local", "--non-interactive", "--prepare-only", "--env-file", envFile], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        MODEL_NAME: "fast-test-model",
        MODEL_API_KEY: "local-model-key",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const environment = await readFile(envFile, "utf8");
    expect(environment).toContain("BARLAS_INSTALL_MODE='local'");
    expect(environment).toContain("BARLAS_DOMAIN='localhost'");
    expect(environment).toContain("OWNER_EMAIL='owner@barlas.local'");
    const dashboard = spawnSync("bash", ["scripts/dashboard-url.sh", "--env-file", envFile], { cwd: root, encoding: "utf8" });
    expect(dashboard.status, dashboard.stderr).toBe(0);
    expect(dashboard.stdout).toMatch(/^http:\/\/127\.0\.0\.1:17840\/#token=[a-f0-9]{64}\n$/u);
    await rm(temporary, { recursive: true, force: true });
  });
});
