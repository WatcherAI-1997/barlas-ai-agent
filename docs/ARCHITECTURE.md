# Architecture

## Goal

Build one cohesive AI-agent product under the Barlas brand. The product should
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

