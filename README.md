# Barlas AI Agent

**Think ahead. Act beyond.**

![Barlas AI Agent](assets/brand/barlas-ai-agent-logo-original.png)

## Language / Язык

[Türkçe](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#tr) ·
[Azərbaycanca](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#az) ·
[Türkmençe](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#tk) ·
[O‘zbekcha](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#uz) ·
[Қазақша](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#kk) ·
[Кыргызча](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#ky) ·
[ئۇيغۇرچە](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#ug) ·
[Татарча](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#tt) ·
[Башҡортса](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#ba) ·
[Монгол хэл](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#mn) ·
[Русский](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#ru) ·
[English](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md#en) ·
[All 38 languages](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md)

Barlas AI Agent is an independent, brand-owned AI agent platform inspired by
the strongest product ideas in OpenClaw and Nous Research Hermes Agent.

## Product principles

- One assistant with persistent memory and long-running task execution.
- Model-agnostic routing across cloud and local providers.
- Tools, files, web research, schedules, and isolated subagents.
- Explicit approval gates for destructive or externally visible actions.
- Private-by-default storage, auditable actions, and cost controls.
- Complete operational isolation from all existing production agents.

## Status

The isolated foundation now includes a branded HTTP API, an OpenAI Responses
API adapter, a task-aware model router, PostgreSQL conversation and long-term
memory storage, an authenticated Telegram webhook, approval policy primitives,
an auditable tool executor, durable job storage, container hardening, and
automated tests. The private-alpha core also includes versioned skills,
owner-installed candidates with automated activation tests, bounded
subagent workflows, per-user file workspaces, and a native autonomous tool loop
with hard step limits, durable checkpoints, approval continuation, restart
recovery, cancellation, an asynchronous lease worker, live progress, Telegram
delivery, timezone-aware recurring schedules, approval buttons, and a content-safe step journal. It also includes optional SearXNG
web search, a no-shell read-only terminal inspector,
an isolated approval-gated JavaScript browser, PDF/DOCX extraction, Unicode
DOCX creation, an authenticated personal file cabinet with safe upload/download,
secure media uploads, vision/PDF analysis, audio transcription,
speech generation, and an approval-gated offline Python/Node/Git/npm sandbox,
encrypted GitHub/Drive/Gmail/Calendar connections with approval-gated writes,
and SSRF-protected remote MCP Streamable HTTP tools,
atomic per-user quotas, execution traces, secure owner/user accounts, and a
branded web cabinet with conversation history, approvals, job controls, and
token/cost monitoring. Named projects group files, conversations, runs, and
memories, while immutable SHA-256 artifact snapshots provide recoverable result
versions. Project goals, ordered plans, progress checkpoints, and idempotent
agent-run summaries preserve execution state. A dedicated project-execution
skill lets the agent inspect that state and propose approval-gated goal, plan,
checkpoint, snapshot, and restore updates. A reproducible live evaluation suite scores persisted
status, tool use, events, output constraints, steps, tokens, and cost without
letting the model grade itself. First-login onboarding and account settings provide a
broad Turkic-language catalogue, Mongolian, Russian/English fallbacks, RTL
handling, and a persisted response-language preference shared with linked
Telegram. No production agent, token,
configuration, memory, port, database, or process is shared with this project.

## Local verification

```bash
npm install
npm run check:isolation
npm run typecheck
npm test
npm run build
```

Copy `.env.example` to `.env` only inside an isolated development environment
and replace every placeholder secret before starting the containers.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Isolation policy](docs/ISOLATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Agent evaluation](docs/AGENT_EVALUATION.md)
- [Production deployment](docs/DEPLOYMENT.md)
- [Backup and recovery](docs/BACKUP_RECOVERY.md)
- [Release readiness](docs/RELEASE_READINESS.md)
- [Product overview in 38 languages](docs/PRODUCT_OVERVIEW_MULTILINGUAL.md)
- [Privacy policy template](docs/PRIVACY_POLICY_TEMPLATE.md)
- [Terms of use template](docs/TERMS_OF_USE_TEMPLATE.md)
- [Acceptable use](docs/ACCEPTABLE_USE.md)
- [Security policy](docs/SECURITY.md)
