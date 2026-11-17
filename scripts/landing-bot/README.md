# scripts/landing-bot — the landing bot's shared rules

Six automations are planned under #5600: the branch keeper, the conflict resolver, the ejection handler, main
repair, the after-green refresh and red-PR repair (#5622). This folder holds the limits all six obey, written once
and tested (#6467, plan key C1). It has no workflow, makes no GitHub write and calls no model. Each automation reads
its data, passes it in, and does only what these functions allow.

**Defaults are closed.** With no variable set, every function answers "do nothing".

| File | What it holds |
| --- | --- |
| `rules.mjs` | `mode()` (`LANDING_BOT_ENABLED`: `true`, `dispatch`, otherwise off), `eligible()`, `breakers()`, `verdictFor()` (wraps `../lib/ciClassify.mjs`), `attempts()`, `budget()`, `pathGuard()` (imports `../merge-policy.mjs`'s T2 rating), `giveUp()`, `order()`, the `dispatchable` workflow list, the sticky comment helpers and the label names. |
| `ejection-rules.mjs` | The ejection handler's pure rules (#6476): consent, the class of an ejection, and the decision to re-queue, label or hand to the keeper or repair. |
| `ejection.mjs` | The ejection handler's sweep: one GraphQL read of the 100 most recently updated PRs, the CI evidence, labels, one comment, and `enqueuePullRequest`. |
| `keeper-plan.mjs` | The branch keeper's plan (#6474): which conflicted PRs a sweep may merge main into, and today's reserved pushes. Pure. |
| `keeper-merge.mjs` | The branch keeper's merge: git with hooks, filters and LFS off, main's merge rules only, the plain-versus-union comparison and the README duplicate check. |
| `keeper.mjs` | The branch keeper's entry point (`plan`, `apply`): reads, re-reads, merges, pushes, labels and comments. |
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

## The branch keeper

`.github/workflows/landing-bot-keeper.yml` (#6474) runs on every push to `main`, every 15 minutes, or by dispatch
with one PR. A PR is merged only when it is all of:
- `CONFLICTING`;
- not in the merge queue: the queue reports its own conflicts, and #6476 handles them;
- quiet for `LANDING_BOT_QUIET_MIN` minutes (default 30);
- not handed back since its last push;
- passing `eligible()`, `attempts()` and `budget()`.

A PR that is only behind is left to the queue.

**The merge.** It runs on a partial clone with hooks, filters, LFS and submodules off. `$GIT_DIR/info/attributes`
sets `merge=text` on every path, then repeats main's merge rules, so a PR cannot add a merge rule. The merge runs
twice, with and without the rules. Only `README.md` files may differ between the two runs, and each one must pass
`../lib/readmeUnion.mjs`.

**What happens next:**
- A clean merge is pushed as a normal merge commit with a `Landing-Bot-Kind: keeper` trailer. If the head moved,
  the push fails, which is intended.
- If GitHub refuses the push because main's changes include a workflow file, the keeper tries the update-branch
  API. If that fails too, it hands the PR back. Each run's summary counts these refusals.
- A real conflict is labelled `conflict` and listed in the sticky comment, and the resolver is asked.
- A conflict in a file `pathGuard()` refuses, or a refused union, is handed back with `needs-session`.

**Daily pushes.** The plan uploads a reservation artifact before any push, and pushes only if the upload
succeeded. The next run counts today's reservations against `LANDING_BOT_DAILY_PUSHES`.

| Actions repository variable | Meaning |
| --- | --- |
| `LANDING_BOT_KEEPER_PER_SWEEP` | PRs merged per run. Unset is 0. Dispatch mode always takes the one named PR. |
| `LANDING_BOT_DAILY_PUSHES` | Bot pushes per UTC day across all kinds. Unset is 0. |
| `LANDING_BOT_QUIET_MIN` | Minutes a head must stay unchanged first; unset is 30. |

## The ejection handler

`.github/workflows/landing-bot-ejection.yml` (#6476) sweeps every 10 minutes. The #4571 guard forbids
`workflow_run`, and a `pull_request` trigger would run a PR's own copy of the workflow. It classifies each new
ejection, then:
- **conflict:** asks the branch keeper; once the keeper's merge has cleared the conflict, the entry may be
  restored;
- **own failure:** labels `ejected` and asks red-PR repair (#5622) once it exists;
- **timeout, manual, unknown:** labels `ejected` only;
- **cascade, flake, infrastructure:** restores the entry on the same head (`enqueuePullRequest` with
  `expectedHeadOid`), but only when all of these hold:
  - a person queued it, or enabled auto-merge, and every later commit is a no-model merge of main;
  - every check is green on that head;
  - the PR passes `eligible()` and the breakers;
  - `[alert] merge queue stalled` is not open;
  - this PR has had fewer than 2 re-queues in 24 hours;
  - the repository is under `LANDING_BOT_DAILY_REQUEUES`;
  - the last 20 queue runs' failure share is under `LANDING_BOT_QUEUE_FAIL_BREAKER`.

Otherwise it labels `ejected` with the reasons. One sticky comment says which.
