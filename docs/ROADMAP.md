# Roadmap

## Phase 0 — Foundation

- Brand, private repository, architecture, threat model, and isolation checks.
- Provider-neutral interfaces for models, tools, memory, and channels.
- Automated tests and a separate local development environment.

## Phase 1 — Private alpha

- Telegram webhook, durable replies, and approval buttons. *(implemented; credentials pending)*
- One-time Telegram-to-account linking and shared identity. *(implemented)*
- Persistent conversations and explicit long-term memory. *(implemented)*
- Web research, files, terminal tools, and task execution. *(SearXNG search, isolated files, and restricted inspection implemented)*
- Model switching and routing. *(fast/deep/private foundation implemented)*
- Approval gates, audit trail, and usage limits. *(implemented foundation)*

## Phase 2 — Agent capabilities

- Native autonomous tool loop with bounded steps and approval pauses. *(implemented)*
- Durable run checkpoints, approval continuation, recovery, cancellation, and step journal. *(implemented)*
- Asynchronous leased agent-run queue, live progress polling, and Telegram result delivery. *(implemented)*
- Durable long-running job storage and schedules. *(worker, leases, retries implemented)*
- Isolated subagents and resumable workflows. *(bounded sequential workflows implemented)*
- Versioned skills with evaluation and rollback. *(versioned registry implemented; evaluation/rollback pending)*
- Approval queue and audit trail. *(foundation implemented)*
- Execution traces and per-user quotas. *(implemented foundation)*
- Admin controls, observability, and cost reporting. *(operations dashboard implemented)*

## Phase 3 — Product

- Branded web application. *(authenticated cabinet foundation implemented)*
- Conversation history, approval inbox, and job controls. *(implemented)*
- Multi-user organizations, roles, and billing foundations. *(accounts and owner/user roles implemented; organizations/billing pending)*
- Connector catalog and deployment automation.
- Security review, backups, recovery drills, and staged release.
