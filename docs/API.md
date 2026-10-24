# Barlas AI Agent API

The API listens on `127.0.0.1:17840` by default. Public exposure must be added
through a separately authenticated reverse proxy; the container does not bind
directly to public interfaces.

## Health

- `GET /health` — process health.
- `GET /ready` — database readiness.

## Authenticated endpoints

Send `Authorization: Bearer <access token>`. Automation uses the dedicated
`BARLAS_API_TOKEN`. The owner Control UI uses the separately generated
`BARLAS_GATEWAY_TOKEN`, following Barlas's own gateway-token flow.
Additional users receive opaque expiring tokens whose SHA-256 hashes are stored
server-side; each plaintext token is shown only once.

- `GET /v1/me` — return the current account and authentication type.
- `POST /v1/auth/logout` — revoke a personal user token; gateway-token logout is browser-local.
- `GET /v1/me/telegram` — return the current account's Telegram link.
- `POST /v1/me/telegram/code` — issue a ten-minute one-time linking code.
- `DELETE /v1/me/telegram` — remove the account's Telegram link.
- `GET /v1/admin/users` — list accounts; owner only.
- `POST /v1/admin/users` — create an owner or user and return its first access token once; owner only.
- `POST /v1/admin/users/:id/access-token` — revoke that account's previous personal tokens and return one replacement once; owner only.
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
- `GET /v1/agents/council` — return the fixed Chief and bounded internal Council roles.
- `GET /v1/system/crisis` — inspect the persistent TEMIR crisis posture (owner/service only).
- `POST /v1/system/crisis/activate` — manually grant TEMIR a bounded 5–60 minute incident window.
- `POST /v1/system/crisis/takeover` — grant TEMIR bounded system-wide crisis command over Barlas agents, runs, and channel responses; this does not grant host privileges or bypass safeguards.
- `POST /v1/system/crisis/assess` — apply the deterministic trusted-monitor threshold; a single alarm or confidence below 0.90 cannot activate TEMIR.
- `POST /v1/system/crisis/release` — end the critical phase and enter ten-minute recovery oversight.
- `POST /v1/system/crisis/reset` — immediately return to standby; control requests and monitor assessments are audited.
- `POST /v1/agents` — create an owned agent with a structured identity card: values, strengths, voice, initiative, risk posture, critique style, color, optional avatar, model class, and workspace.
- `GET /v1/agents` — list the current user's agents and identity versions.
- `PATCH /v1/agents/:id` — evolve an owned identity card with a required reason; protected Barlas authority and safety principles cannot be replaced.
- `GET /v1/agents/:id/revisions` — inspect the immutable identity revision history.
- `DELETE /v1/agents/:id` — delete an unused profile; conversation-bound profiles are retained.
- `POST /v1/memory` — save an explicit long-term memory.
- `GET /v1/memory/search` — retrieve relevant memories for one user.
- `GET /v1/tools` — list registered tools and their risk levels.
- Continuity reminders are configured through the approval-gated
  `continuity.commitments.reminder.configure` tool. They use an explicit first
  reminder time and a bounded 1–168 hour repeat interval; omitting the time
  disables delivery. Reminders stop on completion or cancellation.
- Outcome Mode is exposed to the autonomous runtime through `outcomes.list`,
  `outcomes.inspect`, `outcomes.create`, `outcomes.evidence.add`,
  `outcomes.verify`, and `outcomes.cancel`. Inspection is read-only; every
  mutation enters the normal owner approval queue. Evidence addition
  automatically recomputes verification and agent observation alone is never
  sufficient.
- `GET /v1/extensions` — list built-in extension manifests, capabilities, risk classes, required setting names, and current configuration state without secret values.
- `POST /v1/nodes/pairing-code` — create a short-lived, one-time code for the authenticated account.
- `GET /v1/nodes` — list the account's paired device nodes and last heartbeat.
- `DELETE /v1/nodes/:id` — revoke a node and its bearer token.
- `POST /nodes/pair` — exchange a one-time code for a device token; the plaintext token is returned once.
- `POST /nodes/heartbeat` — update node presence and advertised capabilities with the node token.
- `GET /nodes/commands` — atomically claim a bounded batch of queued commands with the node token.
- `POST /nodes/commands/:id/result` — acknowledge success or failure. The initial protocol only accepts `notify` commands.
- `GET /v1/skills` — list installed skill IDs, versions, descriptions, activation state, tool permissions, runtime readiness (`ready`, `degraded`, or `unavailable`), available/missing tools, and missing hard capabilities.
- `POST /v1/skills` — owner-only installation of an inactive candidate skill version; optional audited `agentskills.io` provenance records an exact SHA-256 without granting trust.
- `POST /v1/skills/packages` — owner-only installation of an Ed25519-signed package after exact publisher-fingerprint confirmation; signature and trust binding are rechecked server-side and written to audit metadata.
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
- `POST /v1/schedules` — create a timezone-aware recurring autonomous task.
- `GET /v1/schedules` — list owned recurring schedules and next-run state.
- `POST /v1/schedules/:id/pause` — pause future occurrences.
- `POST /v1/schedules/:id/resume` — recompute the next occurrence and resume.
- `POST /v1/schedules/:id/disable` — permanently disable a schedule.
- `GET /v1/dashboard` — return health, queue, token, and estimated-cost totals.
- `GET /v1/metrics` — owner/service-only Prometheus text metrics for uptime,
  worker state, queues, approvals, token usage, and estimated model cost. The
  output has no user labels or content-bearing fields.
- `GET /v1/connectors?userId=...` — list the current user's connector metadata.
- `POST /v1/connectors` — encrypt and save a per-user connector credential.
- `DELETE /v1/connectors/:id` — delete an owned connector.
- `GET /v1/integrations/github/profile` — load the connected GitHub profile.
- `GET /v1/integrations/github/repositories` — list accessible GitHub repositories.
- `GET /v1/integrations/google-drive/files` — list recent Drive file metadata.
- `GET /v1/integrations/gmail/messages` — list recent Gmail message/thread IDs.
- `GET /v1/integrations/google-calendar/events` — list upcoming primary-calendar events.
- `POST /v1/media/upload?userId=...&path=media%2Fphoto.png` — upload one
  multipart media file into the user's isolated workspace.
- `GET /v1/files?userId=...&path=.` — list an owned workspace directory.
- `POST /v1/files/upload?userId=...&path=projects%2Finput.txt&overwrite=false`
  — upload one file; replacement requires `overwrite=true` explicitly.
- `GET /v1/files/download?userId=...&path=projects%2Freport.md` — download an
  owned regular file as an attachment.
- `POST /v1/projects` / `GET /v1/projects` — create and list owned projects.
- `GET /v1/projects/:id` — return an owned project with linked resources and artifact versions.
- `POST /v1/projects/:id/resources` — link an owned conversation, run, memory, or workspace file.
- `POST /v1/projects/:id/artifacts` — snapshot the current bytes of an owned file as the next immutable version.
- `POST /v1/projects/:id/artifacts/:versionId/restore` — explicitly restore one owned version to its original path.
- `POST /v1/projects/:id/goals` / `PATCH /v1/projects/:id/goals/:goalId` — create goals and transition their state.
- `POST /v1/projects/:id/steps` / `PATCH /v1/projects/:id/steps/:stepId` — append ordered plan steps and update progress.
- `POST /v1/projects/:id/checkpoints` — record a bounded manual progress checkpoint.

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

Recurring schedules use strict five-field cron expressions and an IANA timezone.
Each due occurrence enqueues the normal durable autonomous runtime, so it keeps
the same step/token/tool limits, approval policy, content-safe events, recovery,
language preference, relevant memory context, and optional Telegram delivery as
an interactive run. A unique schedule ID plus
occurrence timestamp makes dispatch idempotent across worker crashes. Schedules
can run no more frequently than once per minute, consume the daily job quota,
and fail closed when Telegram delivery is requested after the account is
unlinked. Missed occurrences are coalesced rather than replayed as a burst after
downtime. Pausing or disabling a schedule never cancels an already queued run.

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

## Multimodal media

- Media uploads accept one file up to 10 MB. The server identifies the format
  from magic bytes, requires a matching extension and MIME type, and rejects
  SVG or unknown content. Supported inputs are PNG, JPEG, GIF, WebP, PDF, MP3,
  WAV, OGG, M4A/MP4 audio, and WebM audio.
- `media.image.analyze` sends one owned image and a bounded prompt to the
  configured vision model. `media.pdf.analyze` supports native and scanned PDF
  pages. `media.audio.transcribe` sends supported audio to the configured
  transcription model. `media.speech.create` creates an MP3 in the same user's
  workspace using one allowlisted voice.
- All four model-mediated media tools have `external` risk. The exact path and
  arguments enter the approval queue before any file bytes leave the Barlas
  deployment. Uploads themselves are local writes initiated directly by the
  authenticated user and are recorded in the audit log without file contents.
- The built-in `media.understanding` skill exposes only file listing and these
  four approval-gated media operations; it cannot expand its own permissions.
- Configure `VISION_MODEL` (defaults to `MODEL_NAME`), `TRANSCRIPTION_MODEL`,
  and `SPEECH_MODEL`. Provider support and billing depend on the dedicated model
  account; Barlas never silently falls back to another provider for a media call.

## Workspace file cabinet

- The authenticated file cabinet exposes only the requesting user's workspace.
  Paths retain traversal, symlink, regular-file, and ownership protections.
- Ordinary uploads and downloads are streamed instead of buffered in application
  memory. `MAX_WORKSPACE_FILE_BYTES` is a configurable per-file disk boundary
  (2 GB by default); operators may raise it to match available storage.
- Uploads never replace an existing file unless the caller explicitly supplies
  `overwrite=true`. Uploads are written to a restrictive temporary file and
  committed atomically, so an interrupted or oversized upload does not damage
  the previous file. Downloads use `application/octet-stream` and attachment
  disposition so uploaded code or active content is not rendered by the cabinet.
- Audit records contain path and byte count, never file contents. Uploading a
  project file does not execute it; execution remains a separate approval-gated
  sandbox action.

## Projects and artifact versions

- Projects are scoped by `userId`; project lookups, links, artifact versions,
  and restores include the owner in their database predicates.
- `/v1/agent/run` accepts optional `projectId`. The project name, description,
  and bounded linked-resource index become system context, and the durable run
  is linked back to that project automatically.
- Database-backed resources must already belong to the same user. File links
  are resolved through the same isolated workspace boundary before insertion.
- A snapshot stores at most 10 MB, its SHA-256 digest, byte count, original
  path, and an atomically allocated per-path version. Existing versions are
  immutable. Restore is an explicit authenticated request and is audit logged
  without content.
- Goals and plan steps use bounded state machines exposed by validated API
  values. Plan positions are allocated under a PostgreSQL advisory lock.
- A terminal autonomous run linked to a project is summarized into a checkpoint
  automatically. A partial unique index on project + run makes worker retry and
  recovery idempotent; waiting-approval runs are not recorded as completed work.

## Quotas and traces

UTC-day quotas are independently configurable for chat, tool, and job requests.
Counters are incremented atomically in PostgreSQL. Exhausted requests return
HTTP 429 with the category, current usage, and limit. Trace events record start,
completion, pending approval, rejection, retry/failure, and the related IDs;
tool inputs, prompts, file contents, and secrets are not copied into traces.

## Account isolation

Barlas stores no human passwords. Raw personal access tokens are returned once
and never persisted. A normal `user` token may submit only its own account
ID to chat, memory, tools, approvals, jobs, and trace endpoints. Attempts to
substitute another ID return HTTP 403. Owners and the service API token retain
administrative scope. The gateway token is an owner secret and is deliberately
separate from the automation token.

The initial owner is created from `OWNER_EMAIL`, `OWNER_DISPLAY_NAME`, and
optional `OWNER_LANGUAGE`. If the language is omitted, the owner chooses it on
first access. `BARLAS_GATEWAY_TOKEN` is generated independently during
installation, remains in the protected server environment, and can be loaded
into a browser through a URL fragment that is stripped immediately.

## Language preferences

`GET /languages` returns the supported language catalogue without requiring a
session. It includes the broad modern Turkic language family, Mongolian, plus
Russian and English fallbacks, along with native names and writing direction.
Each entry also reports `setupTranslationStatus` (`verified` or `fallback`) and
the exact `setupPhrases` shown by the login and first-login language screens.
`setupTranslation` identifies the schema version, phrase-pack revision, author,
reviewer, review date, requested and effective languages, and completeness.
A fallback is always labelled in the UI and never presented as a verified
translation. Phrase packs for English, Russian, and Uzbek have identical,
complete key sets; all other languages resolve explicitly to the versioned
English pack until their own review is recorded.

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

When `/v1/chat` or `/v1/agent/run` receives an existing owned
`conversationId`, Barlas loads a bounded tail of that conversation and supplies
it to the model before the new messages. Clients may send only the new turn or
repeat a trailing portion of history; exact overlap is removed before model
execution and persistence. At most 80 stored messages and 80,000 characters
are restored, which keeps long-running terminal and web conversations useful
without allowing unbounded context growth.

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

`MODEL_PROVIDER=ollama` routes chat and tool calls to the native Ollama
`/api/chat` endpoint at `OLLAMA_BASE_URL` (localhost by default) and does not
require `MODEL_API_KEY`. Tool-call history is encoded into the same bounded,
durable continuation field used by hosted providers, so an approval or process
restart can resume a local model run without pretending the tool completed.
Ollama token counts are recorded with zero provider cost.

Every autonomous invocation is persisted before the first model call. Its
conversation, limits, provider continuation ID, aggregate usage, pending call,
approval link, terminal result, error, and timestamps live in PostgreSQL. Step
events contain operation names and IDs but not prompts, file bodies, or tool
outputs. Approving or rejecting a linked action resumes that exact run
automatically. If the service stops after the tool decision but before the next
model step, startup recovery finds the executed/rejected approval and continues
from the saved provider response and call ID. Conditional state transitions
prevent a cancelled run from being overwritten by a late model response.

The built-in `project.execution` skill can read the current user's project and
propose goal, ordered-plan, checkpoint, artifact snapshot, or artifact restore
operations. `projects.get` is read-only. Every other `projects.*` operation is
a write: its exact project/goal/step/version identifiers and bounded content are
stored in the normal approval queue and executed only after approval by the
same authenticated user. User identity is taken from tool execution context,
never from model input, preserving tenant isolation.

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
Local installations may set `TELEGRAM_POLLING_ENABLED=true`. Barlas then removes
any old webhook registration and consumes the same validated updates through
official Bot API long polling; the HTTP webhook does not need to be public.
When enabled, Telegram messages enqueue the same durable autonomous runtime.
Results are delivered back to the originating chat. Approval requests use
inline Allow/Reject buttons whose callback is ownership-checked against the
Telegram sender before the tool can execute.
`/voice <prompt>` and `/call <prompt>` explicitly request a bounded speech
version of that run's final answer. The MP3 is stored in the same user's
isolated workspace and uploaded with the official Bot API `sendVoice` method;
the upload boundary is configurable with `TELEGRAM_MAX_UPLOAD_BYTES` (50 MB by
default, matching Telegram's public Bot API). `TELEGRAM_BOT_API_BASE_URL` can
point to a self-hosted local Bot API server, where Telegram supports uploads up
to 2,000 MB. Deployments must keep the configured boundary aligned with their
endpoint and available memory;
generation and delivery metadata are audited without storing answer text in the
audit event. If speech delivery fails, the text answer is sent instead. Telegram
bots cannot initiate native incoming voice/video calls, so `/call` is an honest
voice-reply alias rather than an MTProto user-account call.
An authenticated web user generates a one-time code and sends `/link CODE` to
the bot. Only the SHA-256 code hash is stored; codes expire after ten minutes
and are invalidated after use. Once linked, web and Telegram share the same
account ID, memory, conversations, quotas, approvals, and permissions. A
Telegram identity already linked to another account cannot be silently moved.

## Web voice turns

`GET /v1/voice/status` reports whether transcription and speech generation are
configured. `POST /v1/voice/turn` accepts one magic-byte-validated audio file,
only when the request includes `consent=true`, and runs a contextual chat turn.
It returns the transcript, complete assistant text, and a bounded MP3 reply.
The microphone recording is held only for that request and is not written to
the workspace. The audit event contains byte counts, MIME type, selected voice,
and truncation state, but never the transcript or answer. The browser stops all
microphone tracks immediately after the user ends the recording and also on
page exit. This is push-to-talk, not passive listening or a claimed native
telephone call.

## Safety model

Read-only tools may execute immediately. Write, external, and destructive tools
are persisted as approval requests and cannot execute until the same user
explicitly approves them. Requests, decisions, executions, and durable job
creation, retries, completion, and failure are written to a separate audit log.
The web cabinet uses the autonomous endpoint, while `/v1/chat` remains available
for direct non-tool generation and integrations that need it.
