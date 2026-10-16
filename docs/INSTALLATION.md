# Installation

Barlas AI Agent is installed as an isolated Docker Compose stack on Windows
10/11 with Docker Desktop or on a Linux server. The installer does not reuse,
migrate, stop, or reconfigure any existing
agent. It creates Barlas-specific containers, networks, volumes, ports, database,
workspace, backup storage, encryption keys, and owner account.

## Windows laptop

Install Docker Desktop with the WSL 2 engine and Linux containers. Install
GitHub CLI if it is not already available, then open PowerShell:

```powershell
gh auth login
gh repo clone WatcherAI-1997/barlas-ai-agent
Set-Location barlas-ai-agent
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

No domain, DNS, Caddy, Bash shell, or public port is required. The Windows
installer stores configuration in `deploy\local.env`, restricts its ACL to the
current Windows account and `SYSTEM`, and exposes the cabinet only on loopback.
Docker Desktop must be running and configured for Linux containers.

Useful commands after installation:

```powershell
.\barlas.ps1
.\barlas.ps1 status
.\scripts\dashboard-url.ps1
.\scripts\doctor.ps1 -RequireRunning
```

To prepare and validate configuration without starting containers:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -PrepareOnly
```

An existing `deploy\local.env` is reused and never silently overwritten.
Windows installation is local-only; public HTTPS deployment remains the Linux
server path.

## Linux quick install from the private repository

Authenticate GitHub CLI with an account that can read the repository:

```bash
gh auth login
gh repo clone WatcherAI-1997/barlas-ai-agent
cd barlas-ai-agent
./install.sh --local
```

This personal path requires no domain. It binds the cabinet only to
`127.0.0.1:17840`, skips Caddy and certificate issuance, and stores its protected
configuration in `deploy/local.env`. If a Telegram bot token is supplied, Barlas
uses Bot API long polling rather than a public webhook.

Run `./install.sh` without `--local` only for a public HTTPS server deployment;
that mode asks for a domain and starts Caddy.

Do not place a GitHub personal access token in a `curl` URL or shell history.
A public one-line bootstrap can be published later with signed release artifacts;
while the repository is private, cloning through authenticated GitHub tooling is
the safer and more honest installation path.

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
`MODEL_PROVIDER` to `openai` or `anthropic` (default `openai`). Owner email defaults
to `owner@barlas.local`. Public mode additionally requires `BARLAS_DOMAIN` and
`OWNER_EMAIL`. Optional variables include
`DEEP_MODEL_NAME`, `MEDIA_API_KEY`, `VISION_MODEL`, `TRANSCRIPTION_MODEL`, `SPEECH_MODEL`,
`EMBEDDING_MODEL`, `OWNER_DISPLAY_NAME`, `OWNER_LANGUAGE`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_BOT_API_BASE_URL`, `TELEGRAM_MAX_UPLOAD_BYTES`,
`MAX_WORKSPACE_FILE_BYTES`, `BARLAS_HTTP_PORT`, and `BARLAS_HTTPS_PORT`.

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
Engine, and Docker Compose v2. The Windows local path requires Windows 10/11,
PowerShell 5.1 or newer, Git, Docker Desktop with the WSL 2 engine, and Docker
Compose v2. Neither installer requires Node.js on the host or silently installs
or upgrades system packages.

On Kitty, iTerm2, and WezTerm, the installer renders a tightly cropped installer
variant containing only the original Barlas mark and wordmark. The canonical
logo file remains unchanged. Other terminals receive a compact Unicode fallback
with three true circular glyphs so the brand mark is never distorted.

| Item | Location or name |
|---|---|
| Source checkout | directory selected during `gh repo clone` |
| Protected configuration | `deploy/local.env` (local) or `deploy/production.env` (public) |
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

## After installation

Open the printed web address, sign in as the first owner, verify the selected
language, and run one bounded read-only agent task. The installer prints the
command for producing the tokenized dashboard link, never the token itself.
Then test one write action
and confirm that it stops in `waiting_approval` before execution. Register the
Telegram webhook only after its dedicated bot and public HTTPS endpoint are
ready. Complete every gate in [Release readiness](RELEASE_READINESS.md) before
admitting private-alpha users.
