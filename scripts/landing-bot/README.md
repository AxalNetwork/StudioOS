# scripts/landing-bot — the landing bot's shared rules

Six automations are planned under #5600: the branch keeper, the conflict resolver, the ejection handler, main
repair, the after-green refresh and red-PR repair (#5622). This folder holds the limits all six obey, written once
and tested (#6467, plan key C1). It has no workflow, makes no GitHub write and calls no model. Each automation reads
its data, passes it in, and does only what these functions allow.

**Defaults are closed.** With no variable set, every function answers "do nothing".

| File | What it holds |
| --- | --- |
| `rules.mjs` | `mode()` (`LANDING_BOT_ENABLED`: `true`, `dispatch`, otherwise off), `eligible()`, `breakers()`, `verdictFor()` (wraps `../lib/ciClassify.mjs`), `attempts()`, `budget()`, `pathGuard()` (imports `../merge-policy.mjs`'s T2 rating), `giveUp()`, `order()`, the `dispatchable` workflow list, the sticky comment helpers and the label names. |
| `model/` | The model runner (#6473): task validation and caps, the read-and-edit tools, the provider loop, the patch checks and the three SDK adapters, called by `.github/workflows/landing-bot-model.yml`. [Its README](model/README.md). |
| `workflowGuard.mjs` | The test helper every bot workflow's test calls: `assertWorkflow(path)` fails when the workflow passes the App token to a dispatch call, dispatches a workflow outside `dispatchable`, or names an App or model secret outside the `landing-bot` and `repair` environments. |

The tests are `frontend/test/landing_bot_core_6467.test.mjs`. They live there because `npm run test:frontend`
runs that folder, and adding a glob here would mean editing `package.json`, which these rules protect.

## The limits

- **Attempts:** at most 2 per PR per kind, for the PR's whole life (owner, 2026-11-15: no commit restarts the count,
  a session's included). Counted from the App's commits on the branch (a commit naming the App as author or committer,
  with a `Landing-Bot-Kind:` trailer) and completed bot workflow runs on the PR, whatever their head. Comments are
  never read for counting.
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

## Automatic queue entry

The first-entry feeder (#6481) runs from `main` every ten minutes or by dispatch with one PR number. It uses #6469's ordered landing list and the shared `landPr.decide()` checks. A successful full-suite job must come from the PR's CI workflow on the same commit. The feeder holds PRs with prior queue history, model repairs or uncertain bot attribution for the owner. Issues and PR labels alone do not establish eligibility.

Configure the GitHub Actions environment `landing-bot` to accept deployments from `main` only. Store the dedicated App's ID and key there as `LANDING_BOT_APP_ID` and `LANDING_BOT_APP_PRIVATE_KEY`. The workflow requests an installation token scoped to this repository with contents and pull requests write access. Its runtime credential for API reads has read-only permissions.

| Actions repository variable | Meaning |
| --- | --- |
| `LANDING_AUTO` | The existing landing-policy switch. Queue admission also requires the live PR settings and #5500 closed as completed. |
| `LANDING_BOT_ENABLED` | Unset disables the feeder. Use `dispatch` for the first named T0 rehearsal. Use `true` for scheduled sweeps after #6480 and the rehearsal. |
| `LANDING_BOT_FEED_PER_SWEEP` | Maximum queue requests per run, also bounded by available queue build slots. |
| `LANDING_BOT_DAILY_FEEDS` | Maximum reserved first-entry requests per UTC day. Skipped or ambiguous writes after reservation still consume their reserved slots. |
| `LANDING_BOT_QUEUE_FAIL_BREAKER` | Maximum unsuccessful share of the last 20 completed CI merge-group runs. A value of `0.20` stops admission at four unsuccessful runs. |

Run the named T0 rehearsal with `gh workflow run landing-feeder.yml --ref main -f pr=NUMBER`, after #6469 is on main and the admission checks are satisfied. Check the job summary and link the native queue entry and its successful combined-commit CI run to #6481. To pause future admissions, unset `LANDING_BOT_ENABLED`.

The workflow uploads the exact selected PR numbers and SHAs before requesting the write token, rechecks each candidate, and requests normal queue entry with GitHub's expected-head guard. An uncertain response stops the sweep. Check the PR timeline before taking any action on that entry.
