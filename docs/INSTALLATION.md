# Installation

Barlas AI Agent is installed as an isolated Docker Compose stack on a Linux
server. The installer does not reuse, migrate, stop, or reconfigure any existing
agent. It creates Barlas-specific containers, networks, volumes, ports, database,
workspace, backup storage, encryption keys, and owner account.

## Quick install from the private repository

Authenticate GitHub CLI with an account that can read the repository:

```bash
gh auth login
gh repo clone WatcherAI-1997/barlas-ai-agent
cd barlas-ai-agent
./install.sh
```

Do not place a GitHub personal access token in a `curl` URL or shell history.
A public one-line bootstrap can be published later with signed release artifacts;
while the repository is private, cloning through authenticated GitHub tooling is
the safer and more honest installation path.

The interactive wizard asks for:

- the dedicated domain and non-conflicting host ports;
- the first owner's email, display name, and optional language code;
- fast, deep, vision, transcription, speech, and optional embedding models;
- one dedicated model API key;
- an optional dedicated Telegram bot token.

Database, internal API, connector-vault, sandbox, and optional Telegram webhook
secrets are generated independently with OpenSSL. They are never printed. The
resulting `deploy/production.env` is a regular file with mode `0600` and is
excluded from Git.

## Prepare without starting

Use this before DNS is ready or when another operator will inspect the generated
configuration:

```bash
./install.sh --prepare-only
```

The command creates the protected environment and validates the entire
production Compose graph, but it does not build or start containers. Run the
installer again with the same environment file to start:

```bash
./install.sh --env-file deploy/production.env
```

An existing environment is never regenerated or overwritten. If it contains a
template placeholder, the installer stops and names the file. Edit it directly
on the server or move it aside after making a protected backup.

## Non-interactive installation

Automation may provide configuration through its secret manager and then run:

```bash
./install.sh --non-interactive
```

Required environment variables are `BARLAS_DOMAIN`, `OWNER_EMAIL`,
`MODEL_NAME`, and `MODEL_API_KEY`. Optional variables include
`DEEP_MODEL_NAME`, `VISION_MODEL`, `TRANSCRIPTION_MODEL`, `SPEECH_MODEL`,
`EMBEDDING_MODEL`, `OWNER_DISPLAY_NAME`, `OWNER_LANGUAGE`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BARLAS_HTTP_PORT`, and
`BARLAS_HTTPS_PORT`.

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

The supported production path requires Linux, Git, curl, OpenSSL, Docker Engine,
and Docker Compose v2. The current installer intentionally does not install or
upgrade system packages and does not require Node.js on the host.

On Kitty, iTerm2, and WezTerm, the installer renders a tightly cropped installer
variant containing only the original Barlas mark and wordmark. The canonical
logo file remains unchanged. Other terminals receive a compact Unicode fallback
with three true circular glyphs so the brand mark is never distorted.

| Item | Location or name |
|---|---|
| Source checkout | directory selected during `gh repo clone` |
| Protected configuration | `deploy/production.env` |
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
| Domain still uses `example.com` | Replace it with the dedicated DNS hostname |
| API container unhealthy | Inspect `docker compose ... logs api` and the migration service |
| HTTPS unavailable on 18443 | Include the port in the URL or terminate HTTPS at the existing proxy |

## Update

Create a database and workspace backup, inspect the target commit, then:

```bash
git pull --ff-only
./install.sh --env-file deploy/production.env
./scripts/doctor.sh --env-file deploy/production.env --require-running
```

The existing protected configuration is reused. Compose rebuilds the reviewed
source, ordered migrations run before the API starts, and named volumes remain
intact. Database rollback and restore remain separate explicit operations; see
[Backup and recovery](BACKUP_RECOVERY.md).

## After installation

Open the printed web address, sign in as the first owner, verify the selected
language, and run one bounded read-only agent task. The installer prints the
command for producing the tokenized dashboard link, never the token itself.
Then test one write action
and confirm that it stops in `waiting_approval` before execution. Register the
Telegram webhook only after its dedicated bot and public HTTPS endpoint are
ready. Complete every gate in [Release readiness](RELEASE_READINESS.md) before
admitting private-alpha users.
