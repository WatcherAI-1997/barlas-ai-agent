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

The default web mode is adaptive: short factual turns stay on the fast route,
while substantial, multi-step, project, or skill-backed work is promoted to the
deep route. The bounded loop follows an observe/plan/act/verify protocol and
emits content-safe cognitive phase events for the live Cortex view; private
reasoning and prompts are never exposed by that telemetry.

## Implemented capability boundaries

- The file workspace is a dedicated Barlas AI Agent volume partitioned by a
  SHA-256 user key. It is not mounted from an existing agent installation.
- Built-in skills have immutable IDs, semantic versions, explicit instructions,
  declared tool allowlists, and optional hard capability requirements. Runtime
  listing omits the internal prompt and derives `ready`, `degraded`, or
  `unavailable` from the tools and configured extensions on this installation.
  Unavailable workflows cannot be selected; degraded workflows receive only
  the tools that actually exist plus an explicit no-claim instruction for the
  missing optional actions.
- Owner-installed versions are persisted as inactive candidates. A bounded,
  tool-free acceptance suite must pass before activation; autonomous runs can
  select only active versions, and the skill allowlist is enforced as a ceiling.
- Managed workflows contain at most six sequential subagent steps. A step can
  consume the previous result but cannot recursively create more subagents or
  claim that it performed external actions.
- During an autonomous run the Chief of Barlas may delegate up to five
  independent analytical tasks in parallel to named Council roles. Strategist,
  Researcher, Executor, Critic, Keeper, Guardian, and Dispatcher have distinct
  characters, mandates, authority boundaries, and preferred model-routing
  classes. Delegates receive only supplied context, have no tools or recursive
  delegation, use bounded output, and return usage totals. The Chief reconciles
  dissent and remains accountable for every user-visible conclusion and action.
- Owner-created agents have durable, structured identity cards rather than a
  prompt-only persona: stable values, strengths, communication voice,
  initiative, risk posture, critique style, and visual cues. Each owner-led
  change increments an identity version and saves an immutable snapshot with a
  reason. Runtime instructions append non-overridable owner, permission,
  privacy, accuracy, and non-fabrication principles after custom instructions.
- TEMIR is a separate, persistent Crisis Regent posture, not a general-purpose
  host superuser. Its `system-takeover` posture gives it exclusive incident
  command across Council personalities, chats, autonomous runs, and channel
  responses. Manual owner activation lasts 5–60 minutes. Trusted-monitor
  activation requires critical severity, confidence of at least 0.90, and two
  distinct signals. Active posture is injected into interactive, autonomous,
  and Telegram runs, then expires into a ten-minute recovery phase and finally
  standby. Owner authority, emergency pause, tool permissions, approval gates,
  budgets, and privacy remain unchanged throughout the incident.
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
- The agent can inspect an owned project through a read-only tool. Goal, plan,
  checkpoint, artifact snapshot, and artifact restore tools are all classified
  as writes, so the exact validated input is persisted and execution pauses
  until the owning user approves it. The model never supplies a user ID.
- Media uploads are limited to 10 MB and verified from binary signatures before
  storage. Vision, scanned-PDF analysis, transcription, and speech generation
  use owned workspace paths and remain external approval-gated model calls;
  raw media and model results are not copied into traces or audit details.
- Ordinary workspace files use bounded streaming I/O and atomic temporary-file
  commits. Their configurable disk boundary defaults to 2 GB and is independent
  from the smaller model-mediated media/document inspection boundaries.
- The terminal surface has no arbitrary command or shell entry point. It exposes
  only bounded read-only file inspection operations.
- Approved code execution is delegated to a separate read-only container over
  an authenticated Unix socket. It has no network namespace, Docker socket,
  published port, host mount, or shell expansion; only the user's workspace is
  shared, with process, memory, CPU, time, concurrency, and output limits. Each
  invocation receives a fresh high-numbered Linux UID; the runner restores the
  workspace to the API UID afterward, so code cannot read another user's
  directory or the root-owned runner token.
- With the account-backed model provider, `runner.codex.execute` is registered
  as an external-risk tool. It does not mount the workspace into the model CLI
  and disables shell, network, apps, plugins, memories, user configuration, and
  project instructions. Barlas selects at most 80 non-secret UTF-8 files/500 KB,
  requires schema-constrained output, and validates at most 20 writes/1 MB for
  relative, unique, non-credential text paths before using the tenant-bound
  workspace writer. The runner cannot delete files or push/publish changes.
- Per-user UTC-day counters and execution traces live in the isolated PostgreSQL
  database. Quota consumption is atomic under concurrent requests.
- Human authentication follows the Barlas gateway-token model: a separately
  generated owner token authenticates the Control UI, while additional users
  receive opaque, expiring, revocable tokens stored only as SHA-256 hashes.
  Roles are enforced before user IDs reach storage, tools, quotas, or models.
- The branded web cabinet is served from immutable container assets with a
  restrictive Content Security Policy, no third-party browser scripts, and no
  access to the service automation token.
- Native Windows exposes that same loopback-only cabinet through a dedicated
  Edge application-mode profile and current-user shortcuts. The desktop shell
  starts the existing gateway when needed, adds no listener or privileged
  process, and is also the target of the tray node's Open Barlas action.
- The cabinet uses a responsive sidebar/topbar shell, keyboard-visible focus,
  reduced-motion support, accessible live notifications, and native modal
  dialogs for copyable one-time credentials and run details.
- Conversation history, approval decisions, task cancellation/retry, and the
  operational dashboard all reuse the same account ownership checks. Job state
  transitions are conditional SQL updates, preventing cancellation of an
  already running task or retry of a task that has not failed.
- Barlas commitments are durable owner-scoped records, separate from informal
  memory and scheduled jobs. Every active conversation and scheduled run sees
  unfinished commitments; overdue items are marked in model context. Creating
  or changing one is approval-gated, and both service validation and a database
  constraint prohibit completion without concrete evidence.
- Owners can opt an unfinished commitment into repeating Telegram reminders.
  Reminder delivery uses leased rows with skip-locked claims, acknowledges only
  after successful delivery, retries failures without incrementing the count,
  escalates language after seven overdue days, and stops automatically on
  completion or cancellation. Reminder configuration is approval-gated.
- Outcome Mode stores an owner's desired result separately from tasks and runs.
  Every outcome has required measurable criteria and typed evidence. Adding
  evidence automatically recomputes its state; all criteria need current strong
  passing evidence before verification, while agent observation alone never
  suffices. Outcome mutations are approval-gated and active outcomes are
  injected into interactive, scheduled, and Telegram runtime context.
- Token counts are captured from provider responses. Cost is an estimate based
  only on explicitly configured model rates and is stored as integer micro-USD.
- Deployment-wide Prometheus text metrics reuse the bounded dashboard counters,
  contain no user labels or content, and require an owner or service token.
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
- Local installations bind the cabinet to loopback, omit Caddy, and consume
  Telegram updates through official long polling. Public installations retain
  the secret-authenticated HTTPS webhook path.
- Telegram `/voice` and `/call` are explicit per-message requests for TTS
  delivery through official Bot API `sendVoice`. Output stays in the requesting
  user's workspace, defaults to Telegram's public 50 MB upload boundary, and
  falls back to text on delivery failure. The endpoint and upload boundary are
  configurable for a local Bot API server (up to Telegram's 2,000 MB limit).
  Speech input remains bounded to 4,096 text characters. No userbot, MTProto
  account automation, or false native-call capability is used.

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
