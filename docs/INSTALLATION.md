# Installation

Barlas AI Agent has a native personal mode for Windows 10/11 and an isolated
Docker Compose mode for Linux servers. The installers do not reuse, migrate,
stop, or reconfigure another agent.

## Windows laptop

For the full desktop experience, build or download `Barlas-AI-Agent-Setup.exe`.
It is a current-user graphical installer with a black/red Barlas design,
English/Russian/Uzbek first-run language selection, live progress, an installation
log, optional Desktop and Start Menu shortcuts, launch-after-install, and an
Apps & Features uninstall entry. It does not request administrator access. Model
account sign-in is deliberately deferred until Barlas opens, so credentials are
never placed in installer arguments or logs.

Maintainers build the deterministic NSIS package from a clean checkout on
Windows with:

```powershell
.\scripts\build-windows-installer.ps1
```

The command creates `artifacts\Barlas-AI-Agent-Setup.exe` and a matching
SHA-256 file. NSIS 3 and Git for Windows are build-time requirements only; end
users do not need them. Release signing remains a separate release gate.

The console bootstrap remains available for inspection and recovery. Open
PowerShell and run:

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/install-windows.ps1 | iex
```

No GitHub account, Git, Node.js, Docker Desktop, WSL, domain, DNS, Caddy, Bash
shell, or public port is required. The bootstrap downloads source into
`%LOCALAPPDATA%\Barlas\app`, installs its own portable Node.js and Chromium,
and uses an embedded PGlite database stored under `%LOCALAPPDATA%\Barlas\data`.
It preserves data and configuration during updates, installs a global `barlas`
launcher for the current user, and adds a current-user startup entry. The
configuration is stored in `deploy\native.env`, restricted to the current
Windows account and `SYSTEM`, and the cabinet is exposed only on loopback.

Both installation paths create **Barlas Desktop** shortcuts on the current user's
Desktop and Start Menu. The shell opens the loopback cabinet in Microsoft Edge
application mode with a dedicated Barlas profile, so it behaves as a separate
window without browser tabs or address chrome. It does not bundle Electron,
open another network listener, or create a second copy of the agent or its
data. The tray node's **Open Barlas** action uses the same launcher.

Useful commands after installation:

```powershell
barlas
barlas status
barlas desktop
barlas desktop install
barlas desktop status
barlas desktop uninstall
& "$env:LOCALAPPDATA\Barlas\app\scripts\dashboard-url.ps1"
& "$env:LOCALAPPDATA\Barlas\app\scripts\doctor-native.ps1"
& "$env:LOCALAPPDATA\Barlas\app\scripts\stop-native.ps1"
& "$env:LOCALAPPDATA\Barlas\app\scripts\start-native.ps1" -WaitReady
```

`desktop install` repairs both current-user shortcuts. `desktop uninstall`
removes those shortcuts and the isolated UI profile without touching the
gateway or agent data. Full Barlas uninstall removes them automatically.
Microsoft Edge/WebView must be available; failure to create this optional shell
does not prevent the local gateway from installing.

The complete Barlas setup and configuration surface is available after install:

```powershell
barlas onboard
barlas onboard complete
barlas onboard private
barlas onboard developer
barlas onboard server
barlas onboard import
barlas configure identity
barlas configure models
barlas configure memory
barlas configure tools
barlas configure channels
barlas configure integrations
barlas configure automations
barlas configure security
barlas config list
barlas config get MODEL_NAME
barlas config set MODEL_NAME gpt-5
barlas config file
barlas config schema
barlas config validate
barlas models status
barlas models configure
barlas models login
barlas models auth-status
barlas models logout
barlas channels status
barlas channels add telegram
barlas agents
barlas agents create research "Researcher" --style analytical --task deep --project PROJECT_ID
barlas agent "Research this" --profile AGENT_ID
barlas integrations add github personal
barlas integrations test CONNECTOR_ID
barlas security audit
barlas gateway restart
barlas update check
barlas update
barlas update rollback
barlas repair
barlas uninstall
barlas uninstall --purge
```

Secret values are redacted by `config list/get`. Setting a secret on the command
line is refused so it cannot leak into PowerShell history; the secure wizard
prompts for it instead. Configuration changes are written atomically, the
Windows ACL is reapplied, and the local Gateway is restarted when required.
Updates are pinned to the exact public GitHub commit returned by the release
lookup. The previous application version is retained for `update rollback`;
the embedded database and workspaces live outside the application directory.
Uninstall preserves those data and a protected configuration backup unless
`--purge` is explicitly selected and confirmed.

The onboarding profiles are starting points, not separate editions. `complete`
walks through all ten sections and is the default; `quick`
asks only for the essentials; `private` selects local Ollama and disables
external channels; `developer` raises bounded agent limits and exposes advanced
sections; `server` applies higher worker quotas while keeping the native Windows
gateway on loopback; `import` reads only allowlisted keys from an existing
Barlas `.env` file. Import never evaluates PowerShell, shell syntax, or install
hooks, and protected runtime tokens are not imported.

The native Windows model menu offers four real access paths: OpenAI account
browser sign-in, OpenAI API key, Anthropic API key, and local Ollama. Account
sign-in launches the bundled official CLI OAuth flow and verifies it with the
CLI status command. Barlas does not read, copy, print, or place the OAuth token
in `native.env`. The account-backed model bridge disables its own shell, apps,
plugins, memories, subagents, skills, and web search; only Barlas tools remain
available through the normal approval and audit boundaries. An optional
separate API key is still required for media or semantic embeddings.

An existing `deploy\native.env` is reused and never silently overwritten.
Windows installation is local-only. Native mode does not expose the
container-isolated code sandbox; public HTTPS and hardened sandbox deployment
remain the Linux server path.

## Linux quick install

Clone the public repository:

```bash
git clone https://github.com/WatcherAI-1997/barlas-ai-agent.git
cd barlas-ai-agent
./install.sh --local
```

This personal path requires no domain. It binds the cabinet only to
`127.0.0.1:17840`, skips Caddy and certificate issuance, and stores its protected
configuration in `deploy/local.env`. If a Telegram bot token is supplied, Barlas
uses Bot API long polling rather than a public webhook.

Run `./install.sh` without `--local` only for a public HTTPS server deployment;
that mode asks for a domain and starts Caddy.

Do not place GitHub personal access tokens or model credentials in a command URL
or shell history. The public repository does not require GitHub authentication.

The interactive wizard asks for:

- a local port, or a dedicated domain and public ports in public mode;
- the first owner's email, display name, and optional language code;
- fast, deep, vision, transcription, speech, and optional embedding models;
- one dedicated model API key;
- an optional dedicated Telegram bot token.

Database, internal API, connector-vault, sandbox, and optional Telegram webhook
secrets are generated independently with OpenSSL. They are never printed. The
resulting `deploy/local.env` or `deploy/production.env` is a regular file with
mode `0600` and is excluded from Git.

## Prepare without starting

Use this before DNS is ready or when another operator will inspect the generated
configuration:

```bash
./install.sh --local --prepare-only
```

The command creates the protected environment and validates the entire
production Compose graph, but it does not build or start containers. Run the
installer again with the same environment file to start:

```bash
./install.sh --env-file deploy/local.env
```

An existing environment is never regenerated or overwritten. If it contains a
template placeholder, the installer stops and names the file. Edit it directly
on the server or move it aside after making a protected backup.

## Non-interactive installation

Automation may provide configuration through its secret manager and then run:

```bash
./install.sh --non-interactive
```

Local mode requires only `MODEL_NAME` and `MODEL_API_KEY`; set
`MODEL_PROVIDER` to `openai`, `anthropic`, or `openai_compatible` (default `openai`).
For a compatible hosted or self-hosted Chat Completions endpoint, also set
`MODEL_BASE_URL` to its API version root, such as `https://provider.example/v1`.
Owner email defaults
to `owner@barlas.local`. Public mode additionally requires `BARLAS_DOMAIN` and
`OWNER_EMAIL`. Optional variables include
`DEEP_MODEL_NAME`, `MODEL_BASE_URL`, `MEDIA_API_KEY`, `VISION_MODEL`, `TRANSCRIPTION_MODEL`, `SPEECH_MODEL`,
`EMBEDDING_MODEL`, `OWNER_DISPLAY_NAME`, `OWNER_LANGUAGE`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_BOT_API_BASE_URL`, `TELEGRAM_MAX_UPLOAD_BYTES`,
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_API_BASE_URL`,
`MAX_WORKSPACE_FILE_BYTES`, `BARLAS_HTTP_PORT`, and `BARLAS_HTTPS_PORT`.

WhatsApp uses the official Cloud API. Configure the provider callback to
`https://YOUR_DOMAIN/channels/whatsapp/webhook`, subscribe to message events,
and use the same `WHATSAPP_VERIFY_TOKEN` in both places. Every incoming POST is
verified against `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`; unsigned or
modified payloads are rejected before they reach the agent runtime.

When `MODEL_PROVIDER=anthropic`, chat and agent tools use the Anthropic
Messages API. Vision, PDF analysis, transcription, speech, and embeddings are
disabled unless a separate OpenAI `MEDIA_API_KEY` is supplied; in that case
`VISION_MODEL` is also required. Barlas never sends an Anthropic key to OpenAI.

Pass secrets through the deployment platform's protected environment or secret
store, not as literal command-line arguments. `--verbose` streams build output;
without it, interactive installs write detailed command output to
`logs/install.log` and show one status per stage.

## Open the dashboard with its gateway token

The installer generates `BARLAS_GATEWAY_TOKEN` independently from the service
automation token. No Barlas email/password login exists. On the server, request
an explicit dashboard bootstrap URL:

```bash
./scripts/dashboard-url.sh
```

The token is placed after `#token=`. URL fragments are not sent in HTTP requests
or reverse-proxy logs. The Barlas web cabinet imports it into `sessionStorage`
for the current browser tab and immediately removes it from the address bar.
Closing the tab or pressing **Выйти** clears the browser copy. Keep the generated
link private; anyone holding it has owner access.

## Prerequisites and layout

The supported public production path requires Linux, Git, curl, OpenSSL, Docker
Engine, and Docker Compose v2. The native local path requires Windows 10/11 and
PowerShell 5.1 or newer. Git, GitHub authentication, Node.js, Docker Desktop,
and WSL are not required on Windows; the bootstrap installs private application
runtimes without changing system-wide packages.

On Kitty, iTerm2, and WezTerm, the installer renders a tightly cropped installer
variant containing only the original Barlas mark and wordmark. The canonical
logo file remains unchanged. Other terminals receive a compact Unicode fallback
with three true circular glyphs so the brand mark is never distorted.

| Item | Location or name |
|---|---|
| Source checkout | directory selected during `gh repo clone` |
| Protected configuration | `deploy/native.env` (Windows), `deploy/local.env` (Linux local), or `deploy/production.env` (public) |
| Installer log | `logs/install.log` |
| Compose project | `barlas-ai-agent-production` |
| Database volume | `barlas-ai-agent-production-db` |
| User workspaces | `barlas-ai-agent-production-workspaces` |
| Backups | `barlas-ai-agent-production-backups` |
| Caddy state | dedicated Barlas Caddy volumes |

Only dedicated Barlas directories and volumes are mounted into the production
stack.

## Domain and ports

Defaults `18080` and `18443` avoid silently taking ports from an existing service.
For direct public Caddy certificate issuance, use public ports `80` and `443`
only after confirming they are free. Otherwise keep the isolated defaults and
route the selected domain through an existing operator-controlled reverse proxy
or firewall port mapping. Point DNS at the server before the final HTTPS test.

## Diagnostics

Run configuration-only diagnostics:

```bash
./scripts/doctor.sh
```

Require the complete running stack and `/ready` response:

```bash
./scripts/doctor.sh --require-running
```

The doctor checks commands, Compose v2, non-symlink environment storage, `0600`
permissions, unresolved placeholders, Compose validity, container health, and
the API readiness endpoint. It reports names and states only; secret values are
never printed.

Common problems:

| Problem | Resolution |
|---|---|
| Docker daemon unavailable | Start Docker and grant the intended operator access; rerun doctor |
| Host port already used | Select unused Barlas ports or configure the existing reverse proxy |
| Local cabinet is not reachable remotely | It is intentionally loopback-only; use it on the same machine or an operator-controlled SSH tunnel |
| Domain still uses `example.com` | Replace it with the dedicated DNS hostname |
| API container unhealthy | Inspect `docker compose ... logs api` and the migration service |
| HTTPS unavailable on 18443 | Include the port in the URL or terminate HTTPS at the existing proxy |

## Update

Check and apply a fast-forward update from the private GitHub repository:

```bash
./scripts/update.sh --check
./scripts/update.sh
```

The updater refuses a dirty worktree or a target outside `origin/main`, creates
database and workspace backups, records exact commit IDs, rebuilds the stack,
and runs the full doctor. If health checks fail, it automatically restores the
previous application commit. `--require-signed` additionally enforces
`git verify-commit` for repositories whose release commits are signed.

Explicit application rollback uses:

```bash
./scripts/update.sh --rollback
```

The existing protected configuration is reused. Compose rebuilds the reviewed
source, ordered migrations run before the API starts, and named volumes remain
intact. Database rollback and restore remain separate explicit operations; see
[Backup and recovery](BACKUP_RECOVERY.md).

## Terminal CLI

The host needs only Docker. `./barlas` executes the compiled CLI inside the API
container and reads authentication from the protected container environment;
the gateway token is never placed on the command line. It supports interactive
chat, status, autonomous runs, approvals, jobs, projects, and schedules.

Third-party skill packages use the signed lifecycle:

```bash
./barlas skills verify publisher-skill.json
./barlas skills install publisher-skill.json --trust sha256:VERIFIED_FINGERPRINT
./barlas skills evaluate SKILL_ID VERSION acceptance-cases.json
./barlas skills rollback SKILL_ID PREVIOUS_VERSION
```

Never trust a fingerprint copied only from the package itself. Compare it with
the publisher's independently authenticated release page or direct contact.

### Importing an open Agent Skill from skills.sh

Barlas supports the portable, single-file `SKILL.md` format used by
[skills.sh](https://skills.sh) and the Agent Skills ecosystem. Download or
otherwise review the skill source first; Barlas does not run the external
installer, scripts, hooks, or bundled executables. Inspect the exact file:

```powershell
barlas skills inspect-agent path\to\skill
```

After reading `SKILL.md`, pin the digest printed by that command and import it:

```powershell
barlas skills import-agent path\to\skill --trust-sha256 sha256:REVIEWED_DIGEST
```

The default imported ID is `community.<name>`, the version is `1.0.0`, and no
tools are granted. Optional flags are `--id`, `--version`, and a comma-separated
`--allow-tools`. The result is always an inactive candidate. It still needs
explicit acceptance cases through `skills evaluate` before Barlas permits
activation. Referenced files, scripts, MCP servers, and installation hooks are
not imported or executed; package those capabilities separately through the
signed Barlas lifecycle if they are genuinely required.

For a signed catalog, first verify the catalog key through an independent
maintainer channel, then inspect or install only non-revoked entries:

```powershell
barlas skills catalog verify CATALOG_URL --trust-catalog sha256:CATALOG_FINGERPRINT
barlas skills catalog list CATALOG_URL --trust-catalog sha256:CATALOG_FINGERPRINT --query research
barlas skills catalog install CATALOG_URL SKILL_ID --trust-catalog sha256:CATALOG_FINGERPRINT --trust-publisher sha256:PUBLISHER_FINGERPRINT
```

Catalog trust never automatically grants publisher trust. Barlas pins the
downloaded package bytes, rechecks its publisher signature, blocks signed
revocations and stale catalog sequences, evaluates the candidate without tools,
and activates it only after all acceptance cases pass.

## Discord without a domain

Create a dedicated Discord application and bot, enable the Message Content
intent, invite it only to the intended server, then run
`barlas configure channels`. Barlas connects outbound to the official Gateway;
no inbound port, domain, or webhook is needed. Direct messages are accepted.
In a guild, the bot responds only when explicitly mentioned. Keep the bot token
private and grant no Discord permissions beyond reading and sending messages.

## Slack without a domain

Create a Slack app with Socket Mode, an app-level `xapp-` token carrying
`connections:write`, and a bot `xoxb-` token with only the message scopes the
workspace needs. Subscribe to `message.im` and `app_mention`, install the app,
then run `barlas configure channels`. Barlas acknowledges Socket Mode envelopes
immediately and processes only direct messages or explicit app mentions.

## After installation

Open the printed web address, sign in as the first owner, verify the selected
language, and run one bounded read-only agent task. The installer prints the
command for producing the tokenized dashboard link, never the token itself.
Then test one write action
and confirm that it stops in `waiting_approval` before execution. Register the
Telegram webhook only after its dedicated bot and public HTTPS endpoint are
ready. Complete every gate in [Release readiness](RELEASE_READINESS.md) before
admitting private-alpha users.

## Windows desktop node

After the native Windows gateway is running:

```powershell
barlas node install
```

The command creates a one-time pairing code internally, pairs a separate node
token, protects it with current-user Windows DPAPI, registers current-user
autostart, and launches a tray icon. The client advertises only the
`notifications` capability and rejects every other command kind. It does not
request elevation and contains no remote shell. Use `barlas node uninstall`
and revoke the node record to remove access completely.

For a separate Windows device, first run `barlas node-pair` on the owner
installation, then on that device run:

```powershell
irm https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/install-node-windows.ps1 | iex
```

The bootstrap verifies the pinned SHA-256 of the downloaded client before it
asks for the one-time code.
