# Security policy

## Supported release

Only the current `main` private-alpha commit is supported. Production operators
must record the deployed commit, use dedicated secrets, and apply release gates
from [RELEASE_READINESS.md](RELEASE_READINESS.md).

## Reporting a vulnerability

Do not open a public issue containing exploit details, personal data, tokens,
or credentials. Report privately to `[security contact]` with the affected
version, reproduction steps, impact, and a safe contact method. The operator
should acknowledge receipt within `[72 hours]`, provide a triage update within
`[7 days]`, and coordinate disclosure after a fix is available.

## Scope and safe harbor template

Good-faith testing must use accounts and data you own, avoid persistence,
service disruption, social engineering, privacy violations, and access beyond
the minimum needed to demonstrate a flaw. No automated load testing is allowed
against production without written permission. Insert jurisdiction-specific
safe-harbor language after legal review.

## Operational response

On a credible incident: isolate affected containers, preserve immutable logs,
rotate model/bot/API/session/connector secrets, revoke sessions and OAuth
grants, inspect approval and audit records, restore only from verified backups,
notify affected users and authorities when required, and publish a blameless
post-incident review.

TEMIR Crisis Regent can enter `system-takeover`, where it is the exclusive
incident commander for Barlas agents, autonomous runs, and channel responses.
This is an orchestration lease, not a host privilege bypass. It cannot override
the owner, runtime pause, consent, tool allowlists, approval gates, budgets,
tenant boundaries, or privacy rules. Owner activation expires after at most 60
minutes. Trusted-monitor activation additionally requires
critical severity, at least 0.90 confidence, and two distinct signals. Expiry
enters bounded recovery before returning to standby. State is persisted with
restrictive file permissions; API control requests and monitor assessments are
recorded in the audit log.

Media files are stored only in per-user workspaces. Upload format is determined
from a fixed magic-byte allowlist rather than filename or browser MIME alone;
SVG and unknown formats are rejected. Any vision, PDF, transcription, or speech
model call is an external action and requires explicit approval before bytes
are transmitted to the configured provider.

Third-party skill packages are declarative data, never executable installers.
The default CLI accepts only Ed25519-signed packages and requires the owner to
provide the exact SHA-256 publisher-key fingerprint after verifying it through
an independent channel. The API repeats signature, fingerprint, schema, size,
and tool-allowlist validation and records publisher provenance in the audit
log. Installation creates an inactive candidate; activation requires a passing
bounded evaluation, and a skill cannot enlarge the runtime tool registry.
Private publisher keys remain local and are created with mode `0600`.

Catalogs are a separate trust layer, not a substitute for publisher trust. The
CLI verifies an explicitly trusted Ed25519 catalog key, expiry, monotonic
sequence number, duplicate identities, and signed publisher/version revocations.
It then downloads only an HTTPS package with redirects disabled, verifies the
catalog-pinned SHA-256 bytes, and independently verifies the exact publisher
fingerprint and package signature. The highest accepted sequence is stored
locally so an older still-valid catalog cannot silently roll back revocations.
Installation still uses the server-side signed-package verification and bounded
evaluation gate; catalogs never execute installer scripts.

Discord local mode uses an outbound official Gateway connection and a dedicated
bot token. Guild traffic is ignored unless the Barlas bot is explicitly
mentioned; direct messages are accepted, bot-authored events are discarded,
duplicate event IDs are bounded and suppressed, outbound mention expansion is
disabled, and messages enter the same durable run, approval, quota, and audit
boundaries as web and Telegram requests. The bot should receive only read/send
message permissions and must not be granted administrator privileges.

Slack local mode uses official Socket Mode over an outbound WebSocket. Every
envelope is acknowledged promptly; only direct-message and `app_mention`
events are accepted, bot/subtype events are ignored, and API responses disable
link/media unfurling. Use separate least-privilege `xoxb-` and `xapp-` tokens;
they are treated as secrets and never returned by the extension catalog.

The Windows desktop node is deliberately not a remote administration agent.
It advertises only `notifications`, rejects every other command kind, never
invokes a shell, stores its independent revocable token with current-user
DPAPI, uses only current-user autostart, and accepts plain HTTP only on a
loopback address. Remote gateways require HTTPS. The standalone bootstrap pins
the downloaded client SHA-256. Authenticode signing still requires an external
publisher certificate and must not be claimed until release artifacts are
actually signed and verified in CI.
