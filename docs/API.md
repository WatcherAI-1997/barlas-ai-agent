# Barlas AI Agent API

The API listens on `127.0.0.1:17840` by default. Public exposure must be added
through a separately authenticated reverse proxy; the container does not bind
directly to public interfaces.

## Health

- `GET /health` — process health.
- `GET /ready` — database readiness.

## Authenticated endpoints

Send `Authorization: Bearer <access token>`. Automation may use the dedicated
`BARLAS_API_TOKEN`. Human users authenticate through `POST /auth/login` and
receive an opaque expiring session token whose SHA-256 hash is stored server-side.

- `POST /auth/login` — exchange email/password for an expiring session.
- `POST /auth/password-reset` — consume an owner-issued one-time code and set a new password.
- `GET /v1/me` — return the current account and authentication type.
- `POST /v1/auth/logout` — revoke the current user session.
- `GET /v1/me/telegram` — return the current account's Telegram link.
- `POST /v1/me/telegram/code` — issue a ten-minute one-time linking code.
- `DELETE /v1/me/telegram` — remove the account's Telegram link.
- `GET /v1/admin/users` — list accounts; owner only.
- `POST /v1/admin/users` — create an owner or user account; owner only.
- `POST /v1/admin/users/:id/password-reset` — issue a 15-minute recovery code; owner only.
- `GET /v1/organizations` — list organizations for the current signed-in account.
- `POST /v1/organizations` — create an organization and its first owner membership.
- `GET /v1/organizations/:id/members` — list members for an organization member.
- `POST /v1/organizations/:id/members` — add/update a non-owner member; organization owner/admin only.
- `PATCH /v1/organizations/:id/plan` — change the plan profile; organization owner only.

- `POST /v1/chat` — generate an answer using `fast`, `deep`, or `private` routing.
- `POST /v1/agent/run` — enqueue the bounded autonomous tool loop and return HTTP 202.
- `GET /v1/agent-runs` — list durable autonomous runs for one user.
- `GET /v1/agent-runs/:id` — inspect one owned run.
- `GET /v1/agent-runs/:id/events` — load its ordered, content-safe step journal.
- `POST /v1/agent-runs/:id/cancel` — cancel a running or approval-waiting run.
- `POST /v1/agent-runs/:id/resume` — recover a waiting run after its approval was decided.
- `GET /v1/conversations` — list a user's stored conversations.
- `GET /v1/conversations/:id` — load ordered messages from one conversation.
- `POST /v1/memory` — save an explicit long-term memory.
- `GET /v1/memory/search` — retrieve relevant memories for one user.
- `GET /v1/tools` — list registered tools and their risk levels.
- `GET /v1/skills` — list installed skill IDs, versions, descriptions, activation state, and tool permissions.
- `POST /v1/skills` — owner-only installation of an inactive candidate skill version.
- `POST /v1/skills/:id/:version/evaluate` — run 1–5 bounded, tool-free acceptance cases.
- `POST /v1/skills/:id/:version/activate` — activate a custom version only after its latest evaluation passed.
- `GET /v1/traces` — list recent execution trace events for one user.
- `POST /v1/tools/execute` — execute a read-only tool or create an approval.
- `POST /v1/approvals/:id/decision` — approve or reject a pending action.
- `GET /v1/approvals` — list pending and historical approval requests.
- `POST /v1/jobs` — persist a durable task for immediate or scheduled work.
- `GET /v1/jobs` — list a user's durable tasks.
- `POST /v1/jobs/:id/cancel` — cancel a queued or waiting task.
- `POST /v1/jobs/:id/retry` — requeue a failed or cancelled task.
- `GET /v1/dashboard` — return health, queue, token, and estimated-cost totals.
- `GET /v1/connectors?userId=...` — list the current user's connector metadata.
- `POST /v1/connectors` — encrypt and save a per-user connector credential.
- `DELETE /v1/connectors/:id` — delete an owned connector.
- `GET /v1/integrations/github/profile` — load the connected GitHub profile.
- `GET /v1/integrations/github/repositories` — list accessible GitHub repositories.
- `GET /v1/integrations/google-drive/files` — list recent Drive file metadata.
- `GET /v1/integrations/gmail/messages` — list recent Gmail message/thread IDs.
- `GET /v1/integrations/google-calendar/events` — list upcoming primary-calendar events.

An isolated background run uses `jobType: "agent.run"` and accepts an `input`
with `objective`, optional bounded `context`, and `taskClass` (`fast`, `deep`,
or `private`). The worker leases jobs with PostgreSQL row locking, applies
bounded exponential retries, and records the result or terminal error.

A managed multi-step run uses `jobType: "agent.workflow"`. Its input contains
an objective, optional context, and one to six bounded steps. Every step names
an installed skill and may pin an exact semantic version. `dependsOn` lists only
earlier named steps; independent steps run concurrently with a hard ceiling of
three subagents, while dependent steps receive only the initial context and
their named dependency outputs. Omitting `dependsOn` preserves sequential
execution. Unknown skills, duplicate names, forward dependencies, cycles, and
oversized workflows are rejected before execution.

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
- `browser.open` reads a public HTTP/HTTPS page as bounded plain text. It never
  runs page JavaScript, stores cookies, submits forms, or exposes response
  headers to the model. Every request and redirect is approval-gated, limited
  to standard ports, DNS-checked and connection-pinned against private,
  loopback, link-local, reserved, and metadata-network destinations. Responses
  time out after ten seconds and are capped at 2 MB / 100,000 output characters.
- `browser.interact` is registered only when `BROWSER_WS_ENDPOINT` is set. It
  connects to the isolated Playwright sidecar, executes at most eight bounded
  navigation/click/fill/select/key/wait actions in an ephemeral context, runs
  page JavaScript, and returns bounded text and public links. Every resource is
  checked against the public-network policy; local networks, metadata targets,
  nonstandard ports, downloads, popups, service workers, persistent cookies,
  and credential-like fields are blocked. Interactive browsing is an external
  action and always waits for explicit approval.

## Documents

- `documents.create` writes Markdown (`.md`), plain text (`.txt`), CSV (`.csv`),
  or Unicode DOCX (`.docx`) only inside the current user's isolated workspace.
- `documents.extract` reads bounded text from PDF and DOCX files up to 10 MB.
  Extraction is read-only, output is capped at 100,000 characters, DOCX ZIP CRC
  is checked, and active document content is never executed.
- Document creation is a write action and therefore waits for explicit user
  approval. CSV cells are escaped server-side; paths retain the same traversal,
  symlink, size, and ownership protections as the other file tools.

## Quotas and traces

UTC-day quotas are independently configurable for chat, tool, and job requests.
Counters are incremented atomically in PostgreSQL. Exhausted requests return
HTTP 429 with the category, current usage, and limit. Trace events record start,
completion, pending approval, rejection, retry/failure, and the related IDs;
tool inputs, prompts, file contents, and secrets are not copied into traces.

## Account isolation

Passwords use scrypt with a unique random salt. Raw session tokens are returned
once and never persisted. A normal `user` session may submit only its own account
ID to chat, memory, tools, approvals, jobs, and trace endpoints. Attempts to
substitute another ID return HTTP 403. Owners and the service API token retain
administrative scope. Login attempts are bounded per source address.

The optional initial owner is created from `OWNER_EMAIL`, `OWNER_PASSWORD`,
`OWNER_DISPLAY_NAME`, and optional `OWNER_LANGUAGE`; both email and password
must be supplied together. If `OWNER_LANGUAGE` is omitted, the owner must choose
a language at first login. The
bootstrap is idempotent and never writes credentials to source control.

## Language preferences

`GET /languages` returns the supported language catalogue without requiring a
session. It includes the broad modern Turkic language family, Mongolian, plus
Russian and English fallbacks, along with native names and writing direction.

Authenticated users set or change their preference with
`PATCH /v1/me/preferences` and `{ "languageCode": "uz" }`. The preference is
stored on the account and is applied to web and linked Telegram agent runs.
Unconfigured accounts are stopped at the first-login language screen. The
server adds the preference as a system instruction; an explicit language
request in the user's message still takes precedence.

Organizations add a separate team-membership boundary with `owner`, `admin`,
`member`, and `viewer` roles. Only owners may change the organization plan;
owners and admins may manage non-owner memberships. Organization membership
does not automatically expose another account's conversations, memory, files,
connectors, approvals, or jobs. The `private_alpha`, `team`, and `business`
values are billing/entitlement foundations only; no payment is charged and no
paid entitlement is implied until a billing provider is explicitly configured.

Password recovery codes contain 192 bits of randomness, are stored only as
SHA-256 hashes, expire after fifteen minutes, and are consumed transactionally
exactly once. A successful reset replaces the scrypt salt/hash and revokes all
existing sessions for that account. Barlas AI Agent does not pretend to send
email: until a dedicated mail connector is configured, an owner must deliver
the code to the user through a trusted channel.

## Connector vault, write integrations, and MCP

Connector credentials are encrypted with AES-256-GCM before they reach
PostgreSQL. Every encrypted value uses a fresh 96-bit IV and authenticated
additional data bound to the account, provider, label, and key version. The
plaintext secret is never returned by the connector API, written to traces, or
included in audit details. Connector reads and deletes are scoped by account ID
inside the database query.

Set `CONNECTOR_VAULT_KEY` to the canonical base64 encoding of exactly 32 random
bytes and preserve it independently from the database backup. Production startup
fails when this key is missing. `CONNECTOR_VAULT_KEY_VERSION` records the active
key version; changing it requires an explicit credential re-encryption procedure.

GitHub can read profile/repository metadata and, after explicit approval,
create a branch, create/update one file as a commit, open a pull request, or
open an issue. Google connectors can list bounded metadata and, after approval,
create/update bounded Drive text files, create Gmail drafts, send plain-text
mail, and create/update primary-calendar events. Requests use only fixed
official API origins, reject redirects, time out, and cap responses. Tokens are
retrieved from the encrypted vault only inside the server process. Operators
must issue minimum-scope credentials. The private-alpha accepts an already
issued access token; production OAuth authorization/refresh requires dedicated
client credentials and redirect URIs for the final domain.

An `mcp_http` connector stores a bearer token (or `-` for an unauthenticated
server) and `metadata.endpoint`. Only public HTTPS Streamable HTTP endpoints on
the standard port are allowed. DNS answers are checked against local/private
ranges on every request, redirects stay on-origin, requests time out, and the
transport and returned tool result are bounded. `mcp.tools.list` and every
`mcp.tool.call` are external-risk actions, so the remote server is never called
until the user approves the exact stored arguments. Remote tools cannot bypass
the Barlas tool registry, quota, trace, approval, or audit layers.

Write-capable tools are: `github.branch.create`, `github.file.commit`,
`github.pull_request.create`, `github.issue.create`,
`google_drive.file.create`, `google_drive.file.update`, `gmail.draft.create`,
`gmail.send`, `google_calendar.event.create`, and
`google_calendar.event.update`. GitHub Actions, arbitrary REST endpoints,
HTML email, attachments, Drive binary uploads, event deletion, and bulk
mutations remain disabled.

The chat runtime retrieves up to five relevant memories and supplies them as
context without copying those memories into another user's session.

When `EMBEDDING_MODEL` is configured, new memories also receive a bounded
embedding and recall merges PostgreSQL full-text matches with cosine-ranked
semantic candidates from the same user only. Embeddings are stored as native
PostgreSQL arrays, so the feature does not require a separate vector database.
Provider errors or invalid vectors fall back to lexical recall and never block
chat. Existing memories continue to work and can be embedded later by an
explicit backfill process.

The autonomous endpoint accepts the same conversation fields as chat plus
`maxSteps` (1–12, default configured by `AGENT_MAX_STEPS`), an optional
`maxTotalTokens` budget that cannot exceed the operator's hard limit, and an
optional `allowedTools` allowlist. `skillId` and optional `skillVersion` select
an active evaluated skill, inject its versioned procedure, and reduce the
available tools to that skill's permissions. A caller may narrow this allowlist
further but cannot expand it. The model receives JSON schemas only for registered,
allowed tools. Each returned call is mapped back to the registry and validated
again before execution. Read-only results are returned to the model for the
next step. A write, external, or destructive call stops the loop with
`waiting_approval` and an approval ID; it is never represented to the model as
completed. Exactly one sequential call is accepted in a model step, tool output is
bounded, and total model steps have a hard ceiling of twelve. Execution stops
before another tool call when the total token budget is reached; output per
model step is capped by `AGENT_MAX_OUTPUT_TOKENS_PER_STEP`.

Every autonomous invocation is persisted before the first model call. Its
conversation, limits, provider continuation ID, aggregate usage, pending call,
approval link, terminal result, error, and timestamps live in PostgreSQL. Step
events contain operation names and IDs but not prompts, file bodies, or tool
outputs. Approving or rejecting a linked action resumes that exact run
automatically. If the service stops after the tool decision but before the next
model step, startup recovery finds the executed/rejected approval and continues
from the saved provider response and call ID. Conditional state transitions
prevent a cancelled run from being overwritten by a late model response.

Custom skill versions are persisted as inactive candidates. Installation is
owner-only, tool names must already exist in the deployment, and activation is
blocked until the latest automated evaluation passes every required/forbidden
string assertion. Evaluation runs have no tools, are limited to five cases,
store assertion details rather than full model output, and are audited. Only
one version per skill ID can be active; prior versions remain available for an
evaluated rollback.

The built-in `agent.delegate` tool lets the parent autonomous loop create one
to three independent analytical subagents in parallel. Delegates receive an
objective, one named assignment, and optional bounded context. They have no
tools, cannot recursively delegate, cannot claim external actions, and each
response is capped at 2,048 output tokens and 30,000 characters. Usage is
aggregated and returned to the parent with the findings.

When the optional sandbox is configured, `code.run` executes only `python`,
`node`, `git`, or `npm` with an argument array and no shell interpolation. Every
call is a write-risk action and therefore pauses for explicit approval. The
runner communicates through an authenticated Unix socket, has `network_mode:
none`, no Docker socket or host directories, and sees only the hashed workspace
of the requesting user. A call is limited to 60 seconds, 64 arguments, 100 KB
per output stream, two concurrent processes, and the container CPU/RAM/PID
limits. The production sandbox is enabled only when both
`SANDBOX_SOCKET_PATH` and `SANDBOX_SHARED_TOKEN` are configured.

Queued runs are leased with PostgreSQL `FOR UPDATE SKIP LOCKED`. A worker crash
leaves a recoverable lease; after its timeout another worker may claim the run.
Retries are bounded and use exponential delay. The original visible messages
are stored separately from injected memory context so background completion
cannot leak internal context into conversation history. The web cabinet polls
the content-safe event journal while work continues without holding the submit
request open.

Conversation IDs are ownership-checked inside the database transaction. A
client cannot attach messages to another user's conversation even if it learns
or guesses its UUID.

## Usage and estimated cost

Provider token usage is stored with the assistant message. Estimated cost is
calculated from operator-supplied per-million input/output rates for the fast,
deep, and private routes. Rates default to zero, so the dashboard never claims
a cost estimate until deployment pricing has been configured. Owners may omit
`userId` on the dashboard endpoint for a deployment-wide view; users are always
scoped to their own account.

## Telegram webhook

`POST /channels/telegram/webhook` accepts Telegram updates only when the
`X-Telegram-Bot-Api-Secret-Token` header matches `TELEGRAM_WEBHOOK_SECRET`.
Telegram remains disabled unless both its new bot token and webhook secret are
configured specifically for Barlas AI Agent.
When enabled, Telegram messages enqueue the same durable autonomous runtime.
Results are delivered back to the originating chat. Approval requests use
inline Allow/Reject buttons whose callback is ownership-checked against the
Telegram sender before the tool can execute.
An authenticated web user generates a one-time code and sends `/link CODE` to
the bot. Only the SHA-256 code hash is stored; codes expire after ten minutes
and are invalidated after use. Once linked, web and Telegram share the same
account ID, memory, conversations, quotas, approvals, and permissions. A
Telegram identity already linked to another account cannot be silently moved.

## Safety model

Read-only tools may execute immediately. Write, external, and destructive tools
are persisted as approval requests and cannot execute until the same user
explicitly approves them. Requests, decisions, executions, and durable job
creation, retries, completion, and failure are written to a separate audit log.
The web cabinet uses the autonomous endpoint, while `/v1/chat` remains available
for direct non-tool generation and integrations that need it.
