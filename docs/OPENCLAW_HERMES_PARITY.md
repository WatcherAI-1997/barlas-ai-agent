# OpenClaw + Hermes adaptation map

Barlas does not claim literal feature equality with two mature projects. This
map tracks the useful product patterns that are being adapted into one secure,
free, Windows-first agent rather than copied as incompatible subsystems.

| Product strength | Barlas adaptation | State |
| --- | --- | --- |
| OpenClaw gateway lifecycle and nested CLI | `barlas gateway`, onboard/configure, health, logs, update and rollback | Implemented |
| OpenClaw local channels | Telegram long polling, Discord Gateway, and Slack Socket Mode; no domain required | Implemented |
| OpenClaw channel safety | Dedicated tokens, mention-gated guild chat, approvals and bounded delivery | Implemented foundation |
| OpenClaw nodes | One-time pairing, revocable node tokens, heartbeat and approval-gated notifications | Implemented foundation |
| OpenClaw extension discovery | Typed capability/risk/configuration catalog | Implemented |
| Hermes continuous terminal agent | Persistent conversations, sessions and slash commands | Implemented |
| Hermes autonomous tool loop | Durable bounded runs, recovery, cancellation and approval continuation | Implemented |
| Hermes skills | 30 built-in adapted workflows plus versioned custom skills | Implemented |
| Safer third-party lifecycle | Ed25519 packages, explicit publisher trust, evaluation gate and rollback | Implemented |
| Hermes local models | Ollama chat and tool calls without an API key | Implemented |
| Research and coding workflows | Search/citations, browser, GitHub, debugging, TDD, review and isolated execution | Implemented |
| Memory and planning | Semantic/lexical memory, projects, goals, ordered plans and artifact versions | Implemented |
| Multi-agent execution | Bounded parallel workflows and non-recursive analytical subagents | Implemented |
| Multimodal work | Images, PDF/DOCX, audio transcription and speech replies | Implemented; provider-dependent |
| Wider channel ecosystem | Additional adapters such as Slack/Matrix/WhatsApp where official APIs allow safe local operation | Planned |
| Desktop/mobile control | Windows tray node with DPAPI token, current-user autostart, notifications only, and no remote shell | Implemented foundation; Authenticode/mobile/camera/screen pending |
| Voice conversation | Explicit-consent web push-to-talk with ephemeral recordings and spoken contextual replies | Implemented; full-duplex interruption planned |
| Marketplace | Expiring Ed25519 catalog, HTTPS package hashes, exact publisher trust, revocation and sequence rollback detection | Implemented foundation; reputation UI pending |

## Selection rules

1. Prefer official APIs and domain-free outbound connections for local mode.
2. Never turn a skill or plugin into an implicit executable installer.
3. Preserve Barlas approvals, tenant isolation, audit, quotas and recovery for
   every imported capability.
4. Keep cloud providers optional; local Ollama must remain a first-class path.
5. Do not add a compatibility command until a real backend capability exists.
6. Treat Windows laptop installation as the default experience and Docker as
   the stronger optional server isolation mode.
