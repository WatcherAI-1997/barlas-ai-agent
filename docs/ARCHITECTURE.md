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
- Managed workflows contain at most six sequential subagent steps. A step can
  consume the previous result but cannot recursively create more subagents or
  claim that it performed external actions.
- Web search uses a separately configured open-source SearXNG endpoint. It is
  disabled by default and remains subject to the external-action approval gate.
- The terminal surface has no arbitrary command or shell entry point. It exposes
  only bounded read-only file inspection operations.
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

## Data boundaries

Each deployment has separate secrets, databases, storage, queues, networks,
containers, bot identities, and audit logs. Existing agents are not migration
sources and are not runtime dependencies.

## Initial technology direction

- Containerized services with an isolated Compose project and network.
- PostgreSQL for application state; vector search selected after evaluation.
- Provider adapters instead of hard-coding a single model vendor.
- MCP-compatible external tools where that reduces custom integration work.
- API-first backend so Telegram and the future web interface share one runtime.
