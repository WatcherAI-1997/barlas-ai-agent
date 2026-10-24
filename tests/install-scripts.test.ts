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
    const configure = await readFile(join(root, "scripts", "configure-native.ps1"), "utf8");
    const nativeUpdater = await readFile(join(root, "scripts", "update-native.ps1"), "utf8");
    const nativeUninstaller = await readFile(join(root, "scripts", "uninstall-native.ps1"), "utf8");
    const nativeDesktop = await readFile(join(root, "scripts", "desktop-native.ps1"), "utf8");
    const modelAuth = await readFile(join(root, "scripts", "model-auth-native.ps1"), "utf8");
    const webDiagnostic = await readFile(join(root, "scripts", "web-diagnostic.mjs"), "utf8");
    const windowsNode = await readFile(join(root, "scripts", "windows-node.ps1"), "utf8");
    const installerMenuTest = await readFile(join(root, "tests", "powershell-installer-menu.ps1"), "utf8");
    const configureMenuTest = await readFile(join(root, "tests", "powershell-configure-menu.ps1"), "utf8");
    const dashboard = await readFile(join(root, "scripts", "dashboard-url.ps1"), "utf8");
    const cli = await readFile(join(root, "barlas.ps1"), "utf8");

    expect(installer).toContain("$SupportedLanguageNames");
    expect(installer).toContain('"Монгол хэл", "Русский", "English"');
    expect(installer.indexOf("$OwnerLanguage = Read-OwnerLanguage")).toBeLessThan(installer.indexOf('$SetupMode = Read-MenuChoice'));
    expect(configure).toContain("Select-SetupLanguage");
    expect(configure).toContain("$SupportedLanguageNames");

    for (const required of [
      'BARLAS_INSTALL_MODE = "native"',
      "Protect-SecretFile",
      "RandomNumberGenerator",
      "BROWSER_WS_ENDPOINT = $BrowserEndpoint",
      "scripts\\start-native.ps1",
      'Write-Host "BARLAS" -ForegroundColor White',
      'Write-Host "AI AGENT" -ForegroundColor DarkGray',
      'Write-Host "  THINK AHEAD. "',
      "Read-MenuChoice",
      "Read-ArrowMenu",
      "Read-ValidatedValue",
      "[int]::TryParse",
      "Use arrows to move, type to filter, and press Enter to select.",
      "PageDown",
      "Type to filter",
      '"openai codex" = "codex_cli"',
      "OpenAI account - browser sign-in, no API key",
      "Ollama - local and private",
      '"qwen3:8b"',
      '"gpt-6-astra"',
      '"gpt-6.1-sol"',
      '"custom"',
      "Any other current or future model ID",
    ]) expect(installer).toContain(required);
    expect(installer).not.toContain("$Answer.StartsWith($Candidate)");
    expect(installer).not.toContain("Docker");
    expect(doctor).toContain("Docker and WSL are not used");
    expect(configure).toContain('"file", "schema", "validate"');
    expect(configure).toContain("Do not put secrets in command history");
    expect(configure).toContain("Protect-File");
    expect(configure).toContain("icacls.exe");
    expect(configure).not.toContain("Set-Acl");
    expect(configure).toContain("Read-ArrowChoice");
    expect(configure).toContain("PageDown");
    expect(configure).toContain("Type to filter");
    expect(configure).toContain("Read-MappedChoice");
    expect(configure).toContain("Read-ModelSelection");
    expect(configure).toContain("Any other current, future, or installed model ID");
    expect(configure).toContain("[int]::TryParse");
    expect(configure).not.toContain('Read-Plain "Provider: openai, anthropic, or local ollama"');
    expect(installerMenuTest).toContain("invalid environment provider was accepted");
    expect(configureMenuTest).toContain("invalid existing default");
    for (const profile of ["complete", "quick", "private", "developer", "server", "import"]) expect(configure).toContain(`\"${profile}\"`);
    for (const section of ["identity", "memory", "integrations", "automations", "security"]) expect(configure).toContain(`\"${section}\"`);
    expect(configure).toContain("Import existing Barlas configuration");
    expect(configure).toContain("Imported $Imported supported settings");
    expect(configure).toContain("B A R L A S   O S");
    expect(configure).toContain("by Barlas Bit");
    expect(configure).toContain("Welcome. Let's prepare your personal intelligence system.");
    expect(configure).toContain("Quick Setup (recommended)");
    expect(configure).toContain("BARLAS OS IS READY");
    expect(configure).toContain("barlas web test");
    expect(cli).toContain("doctor-native.ps1");
    expect(cli).toContain('if ($LocalCommand -eq "voice"');
    expect(cli).toContain('if ($LocalCommand -eq "desktop"');
    expect(cli).toContain('"auth-status"');
    expect(cli).toContain("voice-test=1");
    expect(cli).toContain('$LocalCommand -eq "backup"');
    expect(cli).toContain('$RequiresStoppedGateway');
    expect(cli).toContain('$env:BARLAS_NATIVE_DATA');
    expect(cli).toContain("Open the private microphone and voice check now?");
    expect(cli).toContain('$LocalCommand -eq "web"');
    expect(cli).toContain('$Arguments[1] -in @("test", "repair")');
    expect(cli).toContain("WizardArguments");
    expect(webDiagnostic).toContain("WebSearchClient");
    expect(webDiagnostic).toContain("ManagedBrowser");
    expect(windowsNode).toContain("barlas-ai-agent-logo-original.png");
    expect(windowsNode).toContain("barlas-icon.png");
    expect(windowsNode).toContain("BarlasNativeIcon");
    expect(nativeUpdater).toContain('ValidateSet("check", "update", "rollback", "repair")');
    expect(nativeUpdater).toContain("Rollback failed; restoring the current version");
    expect(nativeUpdater).toContain("Protect-File");
    expect(nativeUpdater).toContain("icacls.exe");
    expect(nativeUninstaller).toContain("Type UNINSTALL to continue");
    expect(nativeUninstaller).toContain("uninstalled-native.env");
    expect(nativeUninstaller).toContain("Protect-File");
    expect(nativeUninstaller).toContain("icacls.exe");
    expect(nativeUninstaller).toContain('desktop-native.ps1');
    expect(installer).toContain('desktop-native.ps1');
    for (const required of [
      'ValidateSet("open", "install", "uninstall", "status")',
      'Barlas AI Agent.lnk',
      'WScript.Shell',
      '--app=',
      '--user-data-dir=',
      'StartsWith("http://127.0.0.1:"',
      'start-native.ps1',
      'barlas-ai-agent-logo-original.png',
    ]) expect(nativeDesktop).toContain(required);
    expect(nativeDesktop).not.toContain("Electron");
    expect(modelAuth).toContain('[switch]$Quiet');
    expect(modelAuth).toContain('$ErrorActionPreference = "Continue"');
    expect(modelAuth).toContain('Write-Output "disconnected"');
    expect(modelAuth).not.toContain("exit $LASTEXITCODE");
    expect(dashboard).toContain("#token=$Token");
    expect(cli).toContain("dist/src/cli.js");
    for (const required of [
      "commits/main",
      'archive/$ReleaseSha.zip',
      ".barlas-version",
      'Join-Path $env:LOCALAPPDATA "Barlas"',
      "native.env",
      "barlas.cmd",
      'Start-Process ([string]$DashboardUrl).Trim()',
      "Show-PixelBanner",
      '" ▄██▄  ▄██▄ "',
      '"    ▄██▄    "',
      '"█▀▀▄ ▄▀▀▄ █▀▀▄ █    ▄▀▀▄ ▄▀▀▀"',
      '"              A I   A G E N T"',
      '"{0:D2}/05" -f $Number',
      '"              THINK AHEAD."',
      '" ACT BEYOND."',
      "install.log",
      '"ci", "--include=dev", "--ignore-scripts"',
      'node_modules\\typescript\\bin\\tsc',
      'Invoke-NativeCommand $NodeExe @($TypeScriptCli, "-p", "tsconfig.json")',
      'node_modules\\playwright-core\\cli.js',
      'Invoke-NativeCommand $NodeExe @($Playwright, "install", "chromium")',
      "Last installer log lines:",
      "RestoredEnv",
      "RestoredBuild",
      "AI AGENT COMMANDS",
      'barlas ask "your task"',
      "barlas approvals",
      "barlas approve ID",
      "barlas gateway status",
      "barlas gateway restart",
      "barlas onboard",
      "barlas configure",
      "barlas voice test",
      "nodejs.org/dist",
      "node_modules\\playwright-core\\cli.js",
      "install-native.ps1",
      'param([string]$SourceArchive = "")',
      "Get-FileHash -LiteralPath $OfflineArchive",
      "UTF8Encoding($true)",
      'Get-ChildItem -LiteralPath $AppDir -Filter "*.ps1" -File -Recurse',
    ]) expect(bootstrap).toContain(required);
    expect(bootstrap).not.toContain("docker info");
    expect(bootstrap).not.toContain("Docker.DockerDesktop");
    expect(bootstrap).not.toContain("PERSONAL AI INSTALLER");
    expect(bootstrap).not.toContain("Local/private");
    expect(bootstrap).not.toContain('"BARLAS".ToCharArray()');
    expect(bootstrap).not.toContain("gh auth");
    expect(bootstrap).toContain('$ErrorActionPreference = "Continue"');
    expect(bootstrap).toContain("$Code");
    expect(bootstrap).toContain('(@($BinDir) + $PathParts)');
    expect(bootstrap).toContain('(@($BinDir) + $ProcessPathParts)');
    expect(bootstrap).toContain('Get-Command barlas -CommandType Application');
    expect(bootstrap).toContain('The global Barlas command is shadowed by another installation');
    expect(bootstrap).not.toContain('(@($PathParts) + $BinDir)');
    expect(bootstrap).toContain('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(bootstrap).not.toContain('`r`npowershell.exe -NoProfile');
    expect(installer).toContain('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(cli).toContain('System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(nativeUpdater).toContain('System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsNode).toContain('System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsNode).toContain('desktop-native.ps1');
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
    expect(result.stdout).toContain("▄██▄  ▄██▄");
    expect(result.stdout).toContain("Barlas");
    expect(result.stdout).toContain("A I   A G E N T");
    expect(result.stdout).toContain("THINK AHEAD.");
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
