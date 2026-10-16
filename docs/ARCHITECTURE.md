# Architecture

## Goal

Build one cohesive product named **Barlas AI Agent**. The product should
combine dependable multi-channel operation and tool orchestration with model
independence, durable memory, reusable skills, delegated work, and controlled
autonomy.

## Planned components

1. **Gateway** — Telegram first, then web and additional channels.
2. **Agent runtime** — conversation loop, plans, tools, handoffs, and streaming.
3. **Model router** — selects a capable, economical, or private model per task.
4. **Memory** — user profile, episodic history, semantic retrieval, and retention.
5. **Skills** — versioned reusable procedures with validation and permissions.
6. **Tool sandbox** — isolated filesystem, terminal, browser, and external apps.
7. **Scheduler** — durable recurring and delayed jobs with delivery tracking.
8. **Policy engine** — approvals, allowlists, quotas, tenancy, and audit logs.
9. **Control panel** — users, models, costs, tools, traces, and administration.

## Implemented capability boundaries

- The file workspace is a dedicated Barlas AI Agent volume partitioned by a
  SHA-256 user key. It is not mounted from an existing agent installation.
- Built-in skills have immutable IDs, semantic versions, explicit instructions,
  and declared tool allowlists. Runtime listing omits the internal prompt.
- Owner-installed versions are persisted as inactive candidates. A bounded,
  tool-free acceptance suite must pass before activation; autonomous runs can
  select only active versions, and the skill allowlist is enforced as a ceiling.
- Managed workflows contain at most six sequential subagent steps. A step can
  consume the previous result but cannot recursively create more subagents or
  claim that it performed external actions.
- During an autonomous run the parent model may delegate up to three independent
  analytical tasks in parallel. Delegates receive only supplied context, have
  no tools or recursive delegation, use bounded output, and return usage totals.
- Web search uses a separately configured open-source SearXNG endpoint. It is
  disabled by default and remains subject to the external-action approval gate.
- Interactive JavaScript browsing runs in a separate Playwright container with
  no published port and an ephemeral context per call. The API validates every
  requested resource against the public-network policy before allowing it.
- PDF/DOCX extraction and DOCX creation operate only on per-user workspace
  files with bounded input/output and no macros or active content execution.
- The authenticated file cabinet lists, uploads, and downloads owned workspace
  files. Upload replacement is explicit, downloads are attachment-only, and
  file contents never enter audit details. Upload never implies execution.
- The project layer groups references to owned conversations, agent runs,
  memories, and files. PostgreSQL stores immutable bounded artifact snapshots;
  advisory locking serializes version allocation and SHA-256 identifies exact
  content. Restore overwrites only the original owned workspace path after an
  explicit authenticated request.
- Project execution adds goals, ordered plan steps, and progress checkpoints.
  Worker completion writes an idempotent checkpoint for every linked project;
  approval pauses are excluded and later terminal updates replace the same
  run checkpoint rather than duplicating progress.
- Media uploads are limited to 10 MB and verified from binary signatures before
  storage. Vision, scanned-PDF analysis, transcription, and speech generation
  use owned workspace paths and remain external approval-gated model calls;
  raw media and model results are not copied into traces or audit details.
- The terminal surface has no arbitrary command or shell entry point. It exposes
  only bounded read-only file inspection operations.
- Approved code execution is delegated to a separate read-only container over
  an authenticated Unix socket. It has no network namespace, Docker socket,
  published port, host mount, or shell expansion; only the user's workspace is
  shared, with process, memory, CPU, time, concurrency, and output limits. Each
  invocation receives a fresh high-numbered Linux UID; the runner restores the
  workspace to the API UID afterward, so code cannot read another user's
  directory or the root-owned runner token.
- Per-user UTC-day counters and execution traces live in the isolated PostgreSQL
  database. Quota consumption is atomic under concurrent requests.
- Human authentication uses scrypt password hashes and opaque, expiring,
  revocable server-side sessions. Roles are enforced in the API before user IDs
  reach storage, tools, quotas, or model calls.
- The branded web cabinet is served from immutable container assets with a
  restrictive Content Security Policy, no third-party browser scripts, and no
  access to the service automation token.
- Conversation history, approval decisions, task cancellation/retry, and the
  operational dashboard all reuse the same account ownership checks. Job state
  transitions are conditional SQL updates, preventing cancellation of an
  already running task or retry of a task that has not failed.
- Token counts are captured from provider responses. Cost is an estimate based
  only on explicitly configured model rates and is stored as integer micro-USD.
- The autonomous runtime uses native model function calls. Only registry-derived
  JSON schemas are exposed, model-safe names are mapped back to canonical tool
  IDs, and every argument is validated at the executor boundary. Tool results
  are fed back through the provider protocol until a final answer, approval
  pause, or hard step limit is reached.
- Autonomous run checkpoints and content-safe step events are durable. Pending
  approvals are linked one-to-one with the exact model call; decisions trigger
  continuation, and startup recovery resumes decisions committed immediately
  before a process interruption. Cancellation wins over late completion through
  conditional PostgreSQL updates.
- New runs use a PostgreSQL lease queue and return to web/Telegram immediately.
  Bounded retries recover stale `running` leases, while worker ownership guards
  terminal writes. Visible conversation messages, injected memory context, and
  optional delivery metadata are stored as separate fields.
- A separate leased schedule worker evaluates five-field cron expressions in
  each schedule's IANA timezone. Dispatch uses a unique schedule/occurrence key,
  preventing duplicate autonomous runs after lease expiry or process restart;
  pause/resume/disable transitions are owner-scoped and audited.
- Telegram accounts are joined to web accounts through expiring, single-use,
  hashed codes. The resolved account ID is applied before memory lookup, quota
  consumption, tool execution, and approval ownership checks.

## Data boundaries

Each deployment has separate secrets, databases, storage, queues, networks,
containers, bot identities, and audit logs. Existing agents are not migration
sources and are not runtime dependencies.

## Initial technology direction

- Containerized services with an isolated Compose project and network.
- PostgreSQL for application state; vector search selected after evaluation.
- Provider adapters instead of hard-coding a single model vendor.
- MCP Streamable HTTP external tools through encrypted per-user connections,
  public-HTTPS/SSRF enforcement, bounded responses, same-origin redirects, and
  mandatory approval for every remote call.
- API-first backend so Telegram and the future web interface share one runtime.
