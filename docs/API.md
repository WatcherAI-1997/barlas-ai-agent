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
- `POST /v1/tools/execute` — execute a read-only tool or create an approval.
- `POST /v1/approvals/:id/decision` — approve or reject a pending action.
- `POST /v1/jobs` — persist a durable task for immediate or scheduled work.
- `GET /v1/jobs` — list a user's durable tasks.

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
creation are written to a separate audit log.
