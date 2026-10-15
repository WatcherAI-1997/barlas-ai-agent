# Roadmap

## Phase 0 — Foundation

- Brand, private repository, architecture, threat model, and isolation checks.
- Provider-neutral interfaces for models, tools, memory, and channels.
- Automated tests and a separate local development environment.

## Phase 1 — Private alpha

- Telegram webhook and replies. *(foundation implemented; credentials pending)*
- Persistent conversations and explicit long-term memory. *(implemented)*
- Web research, files, terminal tools, and task execution.
- Model switching and routing. *(fast/deep/private foundation implemented)*
- Approval gates, audit trail, and usage limits.

## Phase 2 — Agent capabilities

- Durable long-running job storage and schedules. *(worker, leases, retries implemented)*
- Isolated subagents and resumable workflows. *(isolated background model runs implemented)*
- Versioned skills with evaluation and rollback.
- Approval queue and audit trail. *(foundation implemented)*
- Admin controls, observability, and cost reporting.

## Phase 3 — Product

- Branded web application.
- Multi-user organizations, roles, and billing foundations.
- Connector catalog and deployment automation.
- Security review, backups, recovery drills, and staged release.
