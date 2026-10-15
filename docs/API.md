# Barlas AI Agent API

The API listens on `127.0.0.1:17840` by default. Public exposure must be added
through a separately authenticated reverse proxy; the container does not bind
directly to public interfaces.

## Health

- `GET /health` — process health.
- `GET /ready` — database readiness.

## Authenticated endpoints

Send `Authorization: Bearer <BARLAS_API_TOKEN>`.

- `POST /v1/chat` — generate an answer using `fast`, `deep`, or `private` routing.
- `POST /v1/memory` — save an explicit long-term memory.
- `GET /v1/memory/search` — retrieve relevant memories for one user.
- `GET /v1/tools` — list registered tools and their risk levels.
- `GET /v1/skills` — list installed skill IDs, versions, descriptions, and tool permissions.
- `POST /v1/tools/execute` — execute a read-only tool or create an approval.
- `POST /v1/approvals/:id/decision` — approve or reject a pending action.
- `POST /v1/jobs` — persist a durable task for immediate or scheduled work.
- `GET /v1/jobs` — list a user's durable tasks.

An isolated background run uses `jobType: "agent.run"` and accepts an `input`
with `objective`, optional bounded `context`, and `taskClass` (`fast`, `deep`,
or `private`). The worker leases jobs with PostgreSQL row locking, applies
bounded exponential retries, and records the result or terminal error.

A managed multi-step run uses `jobType: "agent.workflow"`. Its input contains
an objective, optional context, and one to six ordered steps. Every step names
an installed versioned skill and receives only the initial context plus the
previous step result. Unknown skills and oversized workflows are rejected.

## Isolated file tools

- `files.list` and `files.read` are read-only.
- `files.write` always enters the approval queue before execution.
- paths are relative to a per-user directory derived from a one-way user ID hash;
  absolute paths, traversal, symlink escapes, and files above 1 MB are rejected.
- workspace data is stored in the dedicated `barlas-ai-agent-workspaces` volume.

The chat runtime retrieves up to five relevant memories and supplies them as
context without copying those memories into another user's session.

## Telegram webhook

`POST /channels/telegram/webhook` accepts Telegram updates only when the
`X-Telegram-Bot-Api-Secret-Token` header matches `TELEGRAM_WEBHOOK_SECRET`.
Telegram remains disabled unless both its new bot token and webhook secret are
configured specifically for Barlas AI Agent.

## Safety model

Read-only tools may execute immediately. Write, external, and destructive tools
are persisted as approval requests and cannot execute until the same user
explicitly approves them. Requests, decisions, executions, and durable job
creation, retries, completion, and failure are written to a separate audit log.
