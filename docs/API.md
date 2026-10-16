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
- `GET /v1/traces` — list recent execution trace events for one user.
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

## Web search and restricted terminal

- `web.search` is registered only when `SEARXNG_BASE_URL` points to an operator-
  controlled SearXNG instance. Queries are approval-gated external actions,
  safe-search is enabled, responses are limited to 2 MB, and at most ten
  normalized results are returned.
- `terminal.inspect` does not invoke a shell. It maps four fixed operations
  (`sha256`, `word_count`, `head`, and `tail`) to direct executable calls over
  a previously resolved regular file inside the user's workspace. Runtime and
  output are bounded.

## Quotas and traces

UTC-day quotas are independently configurable for chat, tool, and job requests.
Counters are incremented atomically in PostgreSQL. Exhausted requests return
HTTP 429 with the category, current usage, and limit. Trace events record start,
completion, pending approval, rejection, retry/failure, and the related IDs;
tool inputs, prompts, file contents, and secrets are not copied into traces.

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
