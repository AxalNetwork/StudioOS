# scripts/landing-bot — the landing bot's shared rules

Six automations are planned under #5600: the branch keeper, the conflict resolver, the ejection handler, main
repair, the after-green refresh and red-PR repair (#5622). This folder holds the limits all six obey, written once
and tested (#6467, plan key C1). It has no workflow, makes no GitHub write and calls no model. Each automation reads
its data, passes it in, and does only what these functions allow.

**Defaults are closed.** With no variable set, every function answers "do nothing".

| File | What it holds |
| --- | --- |
| `rules.mjs` | `mode()` (`LANDING_BOT_ENABLED`: `true`, `dispatch`, otherwise off), `eligible()`, `breakers()`, `verdictFor()` (wraps `../lib/ciClassify.mjs`), `attempts()`, `budget()`, `pathGuard()` (imports `../merge-policy.mjs`'s T2 rating), `giveUp()`, `order()`, the `dispatchable` workflow list, the sticky comment helpers and the label names. |
| `workflowGuard.mjs` | The test helper every bot workflow's test calls: `assertWorkflow(path)` fails when the workflow passes the App token to a dispatch call, dispatches a workflow outside `dispatchable`, or names an App or model secret outside the `landing-bot` and `repair` environments. |

The tests are `frontend/test/landing_bot_core_6467.test.mjs`. They live there because `npm run test:frontend`
runs that folder, and adding a glob here would mean editing `package.json`, which these rules protect.

## The limits

- **Attempts:** at most 2 per PR per kind. The series counts the App's commits on the branch (a commit naming the
  App as author or committer, with a `Landing-Bot-Kind:` trailer) and completed bot workflow runs on heads since the
  owning session's newest commit. A bot commit never starts a new series; a session commit does. Comments are never
  read for counting.
- **Per PR in any 24 hours, across kinds:** 4 bot commits and 2 model runs.
- **Main repair:** 2 attempts per failure fingerprint (job plus test), whatever the commit.
- **Daily caps** since 00:00 UTC: `LANDING_BOT_DAILY_MODEL_RUNS` (per provider call), `LANDING_BOT_DAILY_PUSHES`,
  `LANDING_BOT_DAILY_REQUEUES`. An unset cap is 0.
- **Breakers:** main's newest completed push run of CI failed; an open `[alert] main is red`, `[alert] the Actions
  queue is backed up` or `[alert] merge queue stalled`; for the refresh, fresh queued CI runs above
  `LANDING_BOT_MAX_QUEUED_RUNS`, ignoring runs created before `QUEUE_ALERT_IGNORE_BEFORE`.
- `MAX_ATTEMPTS`, `QUIET_MINUTES` and the alert list equal `merge-control/src/lib/repairPolicy.ts`, and a test
  fails if they drift.

## The rule for adding to it

- **A limit is defined here and nowhere else.** A workflow that needs one imports it; it never restates a number.
- **A new bot workflow goes in `dispatchable`** and its test calls `assertWorkflow()`.
- **This folder is T2:** the owner lands every change to it.
