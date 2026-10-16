# Agent evaluation

Barlas AI Agent is evaluated from persisted runtime evidence, not from a model
claiming that its own answer is correct. The live suite starts real autonomous
runs, polls their durable state and event journal, then applies deterministic
criteria to the resulting status, tool names, event types, output, step count,
token usage, and estimated cost.

## Live private-alpha suite

Use a dedicated evaluation account and a deployment with its worker enabled.
Do not use a production owner's account because evaluation conversations and
audit entries are intentionally retained.

```bash
BARLAS_EVAL_BASE_URL=https://agent.example.com \
BARLAS_EVAL_TOKEN='session-token-entered-locally' \
BARLAS_EVAL_USER_ID='account-uuid' \
npm run eval:agent
```

The token is read only from the process environment and is not written to the
report. The JSON report is printed to stdout; progress goes to stderr. Redirect
stdout to a protected artifact only when storing model output is acceptable.
Do not publish reports without reviewing them for user or provider data.

The canonical scenarios are in `evals/live-agent.json` and currently cover:

- deterministic read-only time and text tools;
- exact tool selection and one-call limits;
- mandatory pause before a file write;
- bounded parallel analytical delegation;
- step, token, and estimated-cost ceilings.

The approval-boundary scenario never approves its pending write. After scoring
the `waiting_approval` evidence, the runner explicitly rejects that action and
requires a successful rejection response, leaving no evaluation file behind.
Scenario definitions are strict, bounded, unique by ID, and fail validation on
unknown fields or inconsistent step ranges.

## Interpreting a report

A scenario passes only when every configured check passes. Overall success
requires every scenario to pass. A fractional score helps compare regressions,
but does not override a failed safety or budget check. Tool results, prompts,
and secrets are not read from traces; the evaluator uses only the scenario
prompt it owns, final output, bounded usage totals, and content-safe run events.

Provider quality can vary, so record the commit, model IDs, pricing settings,
date, and deployment configuration beside a retained report. Never change a
golden expectation merely to hide a model regression; update it only when the
product contract intentionally changes.

## Restart recovery drill

Run this separately in an isolated staging deployment:

1. Start the write-approval scenario and wait for `waiting_approval`.
2. Record its run UUID and approval UUID.
3. Restart only the dedicated Barlas API/worker containers.
4. Verify the same run and ordered events are still readable.
5. Reject the approval and verify the exact run resumes without executing the
   write, producing no `evals/approval-check.txt` workspace file.
6. Start a long read-only run, interrupt the worker after its lease is claimed,
   restart it after lease expiry, and verify bounded retry/recovery without a
   duplicate terminal write.

This drill intentionally controls containers and therefore is not automated by
the application test command. It must never target existing agents or a shared
production environment.
