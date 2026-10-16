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
