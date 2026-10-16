# Roadmap

## Phase 0 — Foundation

- Brand, private repository, architecture, threat model, and isolation checks.
- Provider-neutral interfaces for models, tools, memory, and channels.
- Automated tests and a separate local development environment.

## Phase 1 — Private alpha

- Telegram webhook, durable replies, and approval buttons. *(implemented; credentials pending)*
- One-time Telegram-to-account linking and shared identity. *(implemented)*
- Persistent conversations and explicit long-term memory. *(implemented with optional semantic embeddings and lexical fallback)*
- Web research, files, documents, terminal tools, and task execution. *(SearXNG search, SSRF-protected page reader, isolated Playwright interaction, Markdown/TXT/CSV/DOCX creation, PDF/DOCX extraction, isolated files, and restricted inspection implemented)*
- Model switching and routing. *(fast/deep/private foundation implemented)*
- Approval gates, audit trail, and usage limits. *(implemented foundation)*

## Phase 2 — Agent capabilities

- Native autonomous tool loop with bounded steps and approval pauses. *(implemented)*
- Durable run checkpoints, approval continuation, recovery, cancellation, and step journal. *(implemented)*
- Asynchronous leased agent-run queue, live progress polling, and Telegram result delivery. *(implemented)*
- Durable long-running job storage and schedules. *(worker, leases, retries implemented)*
- Isolated subagents and resumable workflows. *(bounded dependency workflows with up to three parallel subagents implemented)*
- Versioned skills with evaluation and rollback. *(multi-version registry, exact pinning, and active-version rollback implemented; automated evaluation pending)*
- Approval queue and audit trail. *(foundation implemented)*
- Execution traces and per-user quotas. *(implemented foundation)*
- Admin controls, observability, and cost reporting. *(operations dashboard implemented)*

## Phase 3 — Product

- Branded web application. *(authenticated cabinet foundation implemented)*
- Conversation history, approval inbox, and job controls. *(implemented)*
- Multi-user organizations, roles, and billing foundations. *(organizations, owner/admin/member/viewer memberships, plan profiles, owner-led onboarding, and one-time account recovery implemented; payment processing pending)*
- Connector catalog and deployment automation. *(encrypted per-user vault plus read-only GitHub, Drive, Gmail, and Calendar metadata connectors implemented; production OAuth credentials pending)*
- Isolated production Compose, HTTPS proxy, database backups, restore guard, and smoke test. *(implemented; credentials and deployment pending)*
- Security review, recovery drill, and staged release. *(internal baseline, load test, database recovery drill, repeatable verification commands, staged gates, privacy/terms/acceptable-use/security templates implemented; independent external/legal review and credentialed release pending)*
