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
