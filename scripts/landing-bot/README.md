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
| `refresh-rules.mjs` | The serial refresh's pure rules (#6478): which PRs inherited main's failure, how many the window allows, and the one-at-a-time loop that stops at a breaker. |
| `refresh.mjs` | The serial refresh's entry point (`plan`, `apply`): update-branch with the App token, else the keeper's runner merge. |
| `keeper-plan.mjs` | The branch keeper's plan (#6474): which conflicted PRs a sweep may merge main into, and today's reserved pushes. Pure. |
| `keeper-merge.mjs` | The branch keeper's merge: git with hooks, filters and LFS off, main's merge rules only, the plain-versus-union comparison and the README duplicate check. |
| `keeper.mjs` | The branch keeper's entry point (`plan`, `apply`): reads, re-reads, merges, pushes, labels and comments. |
| `resolve-rules.mjs` | The conflict resolver's rules (#6475), pure: `gate()` and `afterStage()` before any model call, `checkResolution()` (both sides' added lines kept, no test dropped, no skip added, only the conflicted files), the verify commands and today's reservations. |
| `resolve.mjs` | The conflict resolver's entry point (`plan`, `apply`): stages the merge, builds the model task, then re-checks the patch and the resolution with main's code and pushes a normal merge commit, or hands back. |
| `mainRepair.mjs` | Main repair (#6477): the pure decision (`confirmRed()`, `ownership()`, `choose()`), the patch and revert checks, and the entry point (`plan`, `claim`, `apply`) that takes the repair issue and opens one `main-repair` PR, or steps aside. |
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
- **Daily caps** since 00:00 UTC: `LANDING_BOT_DAILY_MODEL_RUNS` (per model run, whatever its rounds and account fallbacks; owner, 2026-11-17), `LANDING_BOT_DAILY_PUSHES`,
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

## The conflict resolver

`.github/workflows/landing-bot-conflict.yml` (#6475) is dispatched by the branch keeper with one PR number, when
merging main leaves a real conflict. A model resolves the conflicted files only; it must keep both sides. Three jobs:

- **`plan`** (`landing-bot` environment, a read-only token, an App token that reads metadata only, to learn the
  bot's login). It calls no model. In order:
  1. `gate()`: `eligible()`, `attempts()` (at most 2 resolver runs per PR, counted from the run names
     `Conflict resolver for #<n>` and the bot's `Landing-Bot-Kind: conflict` commits) and `budget()`.
  2. It stages the merge on a partial clone (`model/stage.mjs`, the keeper's git settings and main's merge rules
     only) and runs `afterStage()`: no conflict where one side deleted or renamed the file, every conflicted file
     clears `pathGuard()` (so no test, fixture, baseline, auth or money path ever reaches a model), and the conflict
     is within `LANDING_BOT_MAX_CONFLICT_FILES` and `LANDING_BOT_MAX_CONFLICT_LINES`.
  3. It builds the model task: the conflicted files as the only allowed files; each file's base, PR and main
     versions and both changes' descriptions as data; and the verify commands (the three installs, the worker
     typecheck or the frontend build for the side touched, and up to four tests that import a conflicted file).
  4. It reserves today's model run and push in an artifact before the model is called.
  A bot that is off, a PR labelled `bot:off` and an open breaker stop quietly. Anything else hands the PR back.
- **`resolve`** is the model runner (#6473) in merge mode. It has no GitHub write.
- **`apply`** (`landing-bot` environment, the App token, no model key, runs no PR code, scripts from main):
  1. re-reads the PR (head, `bot:off`, mode, breakers);
  2. stages the same merge at the same two commits;
  3. re-checks the patch against the conflicted files' hashes;
  4. runs `checkResolution()`;
  5. commits a normal merge commit (`Landing-Bot-Kind: conflict`, `Landing-Bot-Provider: <provider>`);
  6. re-reads once more, and pushes, never forced.
  Then it removes `conflict`, labels `bot:resolved` and posts the resolution diff in the sticky comment. A head
  that moved stops it quietly. Any other refusal is `giveUp()`: `needs-session` and one comment.

**The owner lands every model-resolved pull request** (owner, 2026-11-16, on #6475). The feeder and the ejection
handler never queue one.

| Actions repository variable | Meaning |
| --- | --- |
| `LANDING_BOT_MAX_CONFLICT_FILES` | The most conflicted files a model is asked to resolve. Unset is 0: none. |
| `LANDING_BOT_MAX_CONFLICT_LINES` | The most lines inside conflict blocks, across those files. Unset is 0: none. |
| `LANDING_BOT_DAILY_MODEL_RUNS` | Resolver runs that may call a model per UTC day. Unset is 0. |

Tests: `frontend/test/landing_bot_conflict_6475.test.mjs`.

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

Otherwise it either waits or hands back (#6476 S1, D6476-p4):
- **Waits, unlabelled,** when only a condition that clears on its own holds: required checks still running on the
  current head (a keeper merge always starts new ones), evidence that could not be read, the head moving between
  reads, a breaker or `[alert] merge queue stalled`, or a daily budget that resets. Each sweep looks again and
  re-reads the head's full-suite and required-check evidence, consent, budgets and breakers; the same removal is
  restored once it all holds. Past 24 hours after the ejection it is handed back instead.
- **Hands back with `ejected`** when the owner must act: no consent (a person removed it, or a commit other than a
  no-model merge of main), a failed required check, `bot:off`, a `repair/` branch, a `.gitattributes` change, or a
  class that is never re-queued.
- **A conflict** asks the keeper only in the first 20 minutes after the ejection; after that the keeper's own
  15-minute schedule runs. If the keeper's merge landed and GitHub still reports a conflict, it hands back.

One sticky comment says which, and a sweep whose outcome has not changed writes nothing. `ejected` labels the App
wrote before 2026-11-21, when it labelled the waiting cases too, get one fresh look on removals under 7 days old;
on a restore the App removes only its own label. A label a person added is never second-guessed.
## The serial refresh

`.github/workflows/landing-bot-refresh.yml` (#6478) acts only when main's newest completed CI push run is green
and an older one in the last 20 was red. It picks open, non-draft PRs whose latest CI run on their current head
failed, and that `verdictFor()` calls `inherited_main_failure` against that red run. Then, one at a time:
- **Before each PR,** it re-reads the mode, `bot:off`, the head and `breakers('refresh')`, which includes the
  queued-runs limit. A breaker stops the run at once.
- **The update** is GitHub's update-branch with `expected_head_sha`. If that refuses the App token, it uses the
  branch keeper's runner merge instead.
- **A conflict** is labelled `conflict` for the keeper and not retried.

| Actions repository variable | Meaning |
| --- | --- |
| `LANDING_BOT_REFRESH_PER_WINDOW` | PRs refreshed per window. Unset is 0. |
| `LANDING_BOT_REFRESH_WINDOW_MIN` | The window in minutes. Unset is 0, which refreshes nothing. |

Each run reserves its refreshes in an artifact before it makes any, and counts the window's reservations.

## Main repair

`.github/workflows/landing-bot-main-repair.yml` (#6477, D6477) sweeps every 10 minutes, or runs by dispatch. The #4571
guard admits `workflow_run` only for pull-request runs, so the trigger gate is applied to the run data instead: main's
newest completed push run of CI, from this repository, failed. D5398 is one repair for a red main, so the bot never
works beside a session. Four jobs:

- **`plan`** (`landing-bot` environment, a read-only token, an App token that reads metadata only). It calls no model
  and writes nothing on GitHub. It stops quietly when:
  - main's newest push run is green, cancelled or unreadable;
  - `verdictFor()` calls the failure infrastructure;
  - `[alert] the Actions queue is backed up` is open;
  - no repair issue is open yet. The issue is `[alert] main is red` from the alert workflow, else D6387's
    CI-on-main issue, written by a trusted author.

  When the issue has a `claim/<n>` ref (expired or not), `state:in-progress`, `needs-session`, a linked open PR, or
  any open PR is labelled `main-repair` or on a `repair/main-` branch, the decision is one comment.

  Otherwise it triages the red run with `../lib/redCiTriage.mjs`: the failing jobs, tests and reproduce commands, the
  first red push and its files. Then it decides:
  - **`repair`:** `attempts()` (2 per failure fingerprint, job plus test, whatever the commit), `budget()` (model runs
    and repair PRs today) and a usable failing command all allow a model.
  - **`revert`:** they do not.

  Before the model is called, it reserves the attempt and today's run as artifacts.
- **`claim`** (`landing-bot`, the App token with contents and issues write) posts the comment and stops. Or it claims
  the issue with `../claim.mjs` as `bot`/`landing-bot`/`main-repair-<run id>` and labels it `state:in-progress`. A
  claim it loses means it steps aside.
- **`repair`** is the model runner on `main`. Its files are the suspected commit's and the failure's, each clearing
  `pathGuard()`. It verifies with the installs, `npm run test:types` and the failing command. It has no GitHub write.
- **`apply`** (`landing-bot`, the App token, no model key, scripts from main, no repository code run):
  1. Re-reads main and the open PRs. A green main or a repair PR that appeared releases the claim and stops.
  2. Re-checks the patch with `checkPatch()`, `pathGuard()` and main's `merge-policy.mjs`. It refuses any change to
     an existing test, the failing test, a guard script, a baseline, an allowlist, a migration or a protected path.
  3. If the model did not pass or the patch is refused, it tries a plain revert of the first red commit. The revert
     needs one parent, a clean apply, no migration and no protected path.
  4. Pushes its own `repair/main-<short sha>` branch, never forced and never main.
  5. Opens ONE PR labelled `main-repair`, with `Part of #<issue>` and the suspected commit named. Then it releases the
     claim and labels the issue `state:review`.
  6. Anything else is one comment, the claim released and `needs-session`.

**The owner lands every repair PR.** No bot queues or merges one. The keeper, the resolver and red-PR repair skip
`repair/` branches (`eligible()`). The feeder holds `Landing-Bot-Kind: main-repair` commits.

| Actions repository variable | Meaning |
| --- | --- |
| `LANDING_BOT_DAILY_MODEL_RUNS` | Model runs per UTC day, counted from this workflow's reservations. Unset is 0: revert only. |
| `LANDING_BOT_DAILY_PUSHES` | Repair PRs per UTC day, counted from `repair/main-` PRs opened today. Unset is 0: comment only. |

Tests: `frontend/test/landing_bot_main_repair_6477.test.mjs`.

