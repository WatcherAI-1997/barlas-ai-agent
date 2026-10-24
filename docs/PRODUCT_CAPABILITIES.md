# Barlas product capability map

Barlas AI Agent is an original, independent, Windows-first product. This map
tracks implemented product capabilities and remaining work without presenting
planned functionality as complete.

| Product capability | Barlas implementation | State |
| --- | --- | --- |
| Gateway lifecycle and nested CLI | `barlas gateway`, onboard/configure, health, logs, update and rollback | Implemented |
| Multiple agents | Owned profiles with independent identity, model-routing class, project workspace, conversation binding and CLI selection | Implemented |
| Domain-free local channels | Telegram long polling, Discord Gateway, and Slack Socket Mode | Implemented |
| Channel safety | Dedicated tokens, mention-gated group chat, approvals and bounded delivery | Implemented foundation |
| Device nodes | One-time pairing, revocable node tokens, heartbeat and approval-gated notifications | Implemented foundation |
| Extension discovery | Typed capability, risk and configuration catalog | Implemented |
| Continuous terminal agent | Persistent conversations, sessions and slash commands | Implemented |
| Autonomous tool loop | Durable bounded runs, recovery, cancellation and approval continuation | Implemented |
| Skills | 47 built-in workflows plus versioned custom skills | Implemented |
| Third-party skill safety | Ed25519 packages, explicit publisher trust, evaluation gate and rollback | Implemented |
| skills.sh / Agent Skills compatibility | Reviewed single-file `SKILL.md` import with exact digest pinning, zero tools by default and inactive-candidate gate | Implemented |
| Local models | Ollama chat and tool calls without an API key | Implemented |
| Research and coding | Search with citations, browser, GitHub, debugging, TDD, review and isolated execution | Implemented |
| Memory and planning | Semantic/lexical memory, evidence-backed commitments, leased Telegram reminders, projects, goals, ordered plans and artifact versions | Implemented |
| Setup localization | Versioned, complete and review-attributed login/setup packs for English, Russian and Uzbek; explicit English fallback metadata for 35 more languages | Implemented foundation; remaining native reviews pending |
| Outcome verification | Durable success criteria, typed evidence and automatic result verification independent of run completion | Implemented foundation |
| Multi-agent execution | Bounded parallel workflows and non-recursive analytical subagents | Implemented |
| Multimodal work | Images, PDF/DOCX/XLSX/PPTX, audio transcription and speech replies | Implemented; provider-dependent |
| Wider channel ecosystem | Additional official adapters where safe local operation is possible | Planned |
| Desktop/mobile control | Branded current-user NSIS setup, Windows desktop app-mode shell and shortcuts plus tray node with DPAPI token, current-user autostart, notifications only, and no remote shell | Windows desktop and reproducible installer implemented; Authenticode/real-device E2E/mobile/camera/screen pending |
| Voice conversation | Explicit-consent web push-to-talk with ephemeral recordings and spoken contextual replies | Implemented; full-duplex interruption planned |
| Skill marketplace | Expiring Ed25519 catalog, HTTPS package hashes, exact publisher trust, revocation and sequence rollback detection | Implemented foundation; reputation UI pending |

## Product rules

1. Prefer official APIs and domain-free outbound connections for local mode.
2. Never turn a skill or plugin into an implicit executable installer.
3. Preserve approvals, tenant isolation, audit, quotas and recovery for every
   capability.
4. Keep cloud providers optional; local models remain a first-class path.
5. Do not expose a compatibility command until a real backend capability exists.
6. Treat Windows laptop installation as the default experience and Docker as
   the stronger optional server isolation mode.
