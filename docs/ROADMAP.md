# Roadmap

## Phase 0 — Foundation

- Brand, private repository, architecture, threat model, and isolation checks.
- Provider-neutral interfaces for models, tools, memory, and channels.
- Automated tests and a separate local development environment.

## Phase 1 — Private alpha

- Telegram webhook, durable replies, and approval buttons. *(implemented; credentials pending)*
- One-time Telegram-to-account linking and shared identity. *(implemented)*
- Persistent conversations and explicit long-term memory. *(implemented with optional semantic embeddings and lexical fallback)*
- Web research, files, documents, terminal tools, and task execution. *(SearXNG search, SSRF-protected page reader, isolated Playwright interaction, Markdown/TXT/CSV/DOCX creation, PDF/DOCX extraction, isolated files, restricted inspection, and approval-gated offline Python/Node/Git/npm sandbox implemented)*
- Model switching and routing. *(fast/deep/private foundation implemented)*
- Approval gates, audit trail, and usage limits. *(implemented foundation)*

## Phase 2 — Agent capabilities

- Native autonomous tool loop with bounded steps and approval pauses. *(implemented)*
- Durable run checkpoints, approval continuation, recovery, cancellation, and step journal. *(implemented)*
- Asynchronous leased agent-run queue, live progress polling, and Telegram result delivery. *(implemented)*
- Durable long-running job storage and schedules. *(job worker, leases, retries,
  timezone-aware recurring cron schedules, idempotent dispatch, pause/resume,
  and web/Telegram delivery implemented)*
- Isolated subagents and resumable workflows. *(bounded dependency workflows plus model-initiated delegation to up to three parallel, tool-free, non-recursive subagents implemented)*
- Versioned skills with evaluation and rollback. *(persistent owner-installed candidates, bounded automated acceptance evaluation, activation gate, exact selection, tool-permission enforcement, and rollback implemented)*
- Approval queue and audit trail. *(foundation implemented)*
- Multimodal image, document, and audio understanding. *(magic-byte-validated
  uploads, approval-gated image/PDF analysis, audio transcription, and MP3
  speech generation implemented; live provider quality evaluation pending)*
- Execution traces and per-user quotas. *(implemented foundation)*
- Admin controls, observability, and cost reporting. *(operations dashboard implemented)*
- Reproducible long-task quality evaluation. *(strict live scenarios and
  deterministic status/tool/event/output/step/token/cost scoring implemented;
  credentialed model baselines and staging restart drill pending)*

## Phase 3 — Product

- Branded web application. *(authenticated cabinet and isolated file manager implemented)*
- Named project workspaces with linked conversations, runs, memories, files,
  and recoverable artifact versions. *(implemented)*
- Project goals, ordered execution plans, progress checkpoints, and automatic
  retry-safe preservation of agent-run outcomes. *(implemented)*
- Agent-managed project execution with read-only state inspection and
  approval-gated goal, plan, checkpoint, artifact snapshot, and restore tools.
  *(implemented)*
- Conversation history, approval inbox, and job controls. *(implemented)*
- Multi-user organizations, roles, and billing foundations. *(organizations, owner/admin/member/viewer memberships, plan profiles, owner-led token onboarding, and access-token rotation implemented; payment processing pending)*
- Connector catalog and deployment automation. *(encrypted per-user vault, GitHub branches/commits/PRs/issues, Drive text-file writes, Gmail drafts/send, Calendar event writes, and remote MCP Streamable HTTP tools implemented with mandatory approval; production OAuth credentials pending)*
- Isolated production Compose, HTTPS proxy, database backups, restore guard, and smoke test. *(implemented; credentials and deployment pending)*
- Security review, recovery drill, and staged release. *(internal baseline, load test, database recovery drill, repeatable verification commands, staged gates, privacy/terms/acceptable-use/security templates implemented; independent external/legal review and credentialed release pending)*
