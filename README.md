# Barlas AI Agent

**Think ahead. Act beyond.**

![Barlas AI Agent](assets/brand/barlas-ai-agent-logo-original.png)

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
automated tests. The private-alpha core also includes versioned skills, bounded
subagent workflows, per-user file workspaces, and a native autonomous tool loop
with hard step limits, durable checkpoints, approval continuation, restart
recovery, cancellation, an asynchronous lease worker, live progress, Telegram
delivery, approval buttons, and a content-safe step journal. It also includes optional SearXNG
web search, a no-shell read-only terminal inspector,
atomic per-user quotas, execution traces, secure owner/user accounts, and a
branded web cabinet with conversation history, approvals, job controls, and
token/cost monitoring. No production agent, token,
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
- [Production deployment](docs/DEPLOYMENT.md)
- [Backup and recovery](docs/BACKUP_RECOVERY.md)
- [Release readiness](docs/RELEASE_READINESS.md)
