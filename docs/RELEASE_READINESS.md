# Release readiness

## Verified on 2026-10-26

- TypeScript typecheck and production build pass.
- 256 automated tests across 68 files pass.
- `npm audit --audit-level=low` reports zero known vulnerabilities.
- The repository security baseline scans tracked text files for common committed
  key formats and verifies container, terminal, and secret-ignore invariants.
- All 26 SQL migrations apply twice to a clean PostgreSQL-compatible database.
- The production Docker image builds and runs read-only with dropped capabilities.
- The pinned Playwright sidecar builds separately, runs read-only as an
  unprivileged user with all capabilities dropped, and completed a live public
  page navigation through the managed-browser client.
- PDF/DOCX extraction and Unicode DOCX creation are bounded by workspace,
  regular-file, size, and output limits; DOCX CRC and expanded XML size are
  checked before text is returned.
- Media tests verify binary-signature/MIME/extension agreement, rejection of
  SVG and unknown content, per-user isolation, bounded upload, and external-risk
  registration for every vision, PDF, transcription, and speech tool.
- File-cabinet tests verify authenticated listing, bounded upload, explicit-only
  overwrite, attachment download, metadata-only audit, and workspace isolation.
- Web-interface checks preserve responsive navigation, visible keyboard focus,
  reduced-motion behavior, accessible live feedback, and dialog-based copying
  without inline scripts or blocking browser alerts.
- Project tests verify cross-user denial, owned resource linking, immutable
  SHA-256 artifact snapshots, project-aware agent context/run linking, and
  explicit restoration of selected versions.
- Project-execution tests cover owned goals, ordered plans, bounded manual
  checkpoints, automatic terminal-run summaries, and retry-safe deduplication.
- Project-tool tests verify that tenant identity comes only from execution
  context, reads execute immediately, and no agent-proposed project mutation
  runs before the exact stored request is approved.
- Crisis Regent tests verify that TEMIR needs either explicit owner activation
  or critical severity with confidence of at least 0.90 and two independent
  monitor signals; active authority expires through recovery to standby, cannot
  refresh itself from repeated alarms, and never replaces approval or owner
  authority. API tests cover persisted control, audit, and runtime injection.
- Installer tests verify Bash syntax, discoverable help, non-interactive
  prepare-only operation, `0600` secret storage, placeholder removal, and that
  supplied secrets never appear in installer output.
- The Windows desktop package is reproducibly defined as a current-user NSIS
  installer with a branded welcome screen, no credential fields, loopback-only
  messaging, a retained installation log, rollback through the hardened
  bootstrap, and an Apps & Features uninstall entry. Its source compiles to a
  PE installer in CI-compatible NSIS; real Windows 10/11 execution and
  Authenticode signing remain release gates.
- The native release smoke starts the production runtime against the embedded
  database and a deterministic compatible-model server, verifies health, one
  real chat, a read-only tool, durable memory, graceful shutdown, restart, and
  persistence of both memory and conversation history. Run it with
  `npm run test:native-release`.
- Native PGlite accepts the same ten connections as the application database
  pool, preventing parallel context reads from being rejected during a normal
  chat turn. Windows start/stop scripts validate the exact private Node binary
  and entrypoint, reject stale or malformed PID files, verify that the launched
  process owns the listening port, and remove a failed launch.
- The public repository reports `private=false`; the one-command Windows
  bootstrap on `raw.githubusercontent.com/.../main/install-windows.ps1` returns
  HTTP 200 without GitHub authentication.
- The live agent evaluation suite validates scenario definitions and scores
  persisted statuses, tools, content-safe events, output constraints, steps,
  tokens, and cost without model self-grading. Credentialed baseline results
  and the staging restart drill remain release requirements.
- The owner/service-only Prometheus endpoint exports label-free uptime, worker,
  queue, approval, token, and estimated-cost metrics without user content.
- Recurring schedule tests cover IANA timezone calculation, invalid zones,
  pause/resume, idempotency-keyed autonomous dispatch, and fail-closed Telegram
  delivery when an account is not linked.
- Telegram voice tests cover explicit `/voice` and `/call` parsing, bounded MP3
  generation in the owned workspace, multipart `sendVoice`, honest native-call
  limitation messaging, and voice-delivery metadata without answer content.
- Web voice tests cover explicit consent, bounded magic-byte-validated audio,
  ephemeral transcription without workspace persistence, contextual chat,
  bounded speech output, immediate browser track shutdown, and metadata-only
  audit events.
- Signed-catalog tests cover Ed25519 tamper detection, expiry, duplicate
  identities, signed publisher/version revocation, stale-sequence rollback
  detection, HTTPS-only package locations, bounded downloads, exact SHA-256
  byte pinning, independent publisher trust, and package identity binding.
- Skill capability tests verify configured-extension discovery, complete,
  degraded, and unavailable states, hard capability blocking, available-tool
  narrowing, API disclosure, and explicit no-claim context for missing actions.
- Codex runner tests verify tenant-root path enforcement, external-risk-only
  registration, secret-file omission, schema-bounded edits, safe file writes,
  and rejection of escaping output without invoking an unrestricted shell.
- A repository-wide branding regression test keeps all tracked product files
  focused on the standalone Barlas identity.
- An isolated live load smoke completed 1,000 `/health` and `/ready` requests at
  concurrency 50 with zero failures and 37.7 ms p95 latency on the test host.
- A PostgreSQL custom dump restored into a separate disposable PostgreSQL 17
  instance; the recovery sentinel and all 18 public tables were present.
- Test containers, networks, and volumes were removed after verification.

## Security boundary

This is an internal security baseline, not an independent penetration test.
Before public release, run a separate reviewer/tool against the final commit and
deployment, resolve findings, rotate test credentials, and record the reviewed
commit SHA. The Codex Security plugin has been suggested for this independent
pass but was not installed during this run.

## Hosted production release gates

1. Configure dedicated production secrets, model key, owner, domain, and bot.
2. Store the connector vault key and backup encryption material off-host.
3. Deploy to the dedicated Barlas AI Agent Compose project only.
4. Run migrations, smoke test, owner gateway-token access, Telegram link, and one approval flow.
5. Create database and workspace backups, restore both into disposable targets,
   and verify `/ready`, login, conversation history, and a bounded autonomous run.
6. Admit only named private-alpha users; monitor errors, queue leases, token cost,
   disk, backup age, and authentication failures for at least 48 hours.
7. Expand gradually only after the independent security review and recovery drill.
8. Run `npm run eval:agent` against the pinned production-candidate models and
   retain the reviewed report with the deployed commit and model IDs.

The public source and domain-free native Windows installer are available now.
A separately hosted multi-user production service remains intentionally blocked
until the operator supplies dedicated credentials and completes the gates above;
no existing working agent is reused.
The privacy/terms/acceptable-use/security documents are operational templates,
not legal advice, and require counsel review for the selected jurisdiction.
