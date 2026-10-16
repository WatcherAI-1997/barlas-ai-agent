# Release readiness

## Verified on 2026-10-16

- TypeScript typecheck and production build pass.
- 125 automated tests across 36 files pass.
- `npm audit --audit-level=low` reports zero known vulnerabilities.
- The repository security baseline scans tracked text files for common committed
  key formats and verifies container, terminal, and secret-ignore invariants.
- All nineteen SQL migrations apply twice to a clean PostgreSQL 17 database.
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
- Project tests verify cross-user denial, owned resource linking, immutable
  SHA-256 artifact snapshots, project-aware agent context/run linking, and
  explicit restoration of selected versions.
- Project-execution tests cover owned goals, ordered plans, bounded manual
  checkpoints, automatic terminal-run summaries, and retry-safe deduplication.
- Project-tool tests verify that tenant identity comes only from execution
  context, reads execute immediately, and no agent-proposed project mutation
  runs before the exact stored request is approved.
- Installer tests verify Bash syntax, discoverable help, non-interactive
  prepare-only operation, `0600` secret storage, placeholder removal, and that
  supplied secrets never appear in installer output.
- The live agent evaluation suite validates scenario definitions and scores
  persisted statuses, tools, content-safe events, output constraints, steps,
  tokens, and cost without model self-grading. Credentialed baseline results
  and the staging restart drill remain release requirements.
- Recurring schedule tests cover IANA timezone calculation, invalid zones,
  pause/resume, idempotency-keyed autonomous dispatch, and fail-closed Telegram
  delivery when an account is not linked.
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

## Staged release gates

1. Configure dedicated production secrets, model key, owner, domain, and bot.
2. Store the connector vault key and backup encryption material off-host.
3. Deploy to the dedicated Barlas AI Agent Compose project only.
4. Run migrations, smoke test, owner login, Telegram link, and one approval flow.
5. Create database and workspace backups, restore both into disposable targets,
   and verify `/ready`, login, conversation history, and a bounded autonomous run.
6. Admit only named private-alpha users; monitor errors, queue leases, token cost,
   disk, backup age, and authentication failures for at least 48 hours.
7. Expand gradually only after the independent security review and recovery drill.
8. Run `npm run eval:agent` against the pinned production-candidate models and
   retain the reviewed report with the deployed commit and model IDs.

Public launch remains intentionally blocked until final credentials and the
operator-selected domain/bot are supplied; no existing working agent is reused.
The privacy/terms/acceptable-use/security documents are operational templates,
not legal advice, and require counsel review for the selected jurisdiction.
