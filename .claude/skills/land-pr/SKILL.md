---
name: land-pr
description: Decide whether a green StudioOS PR may be put in the merge queue by an agent, and do it only when every condition holds. Use when a PR's checks are green and you are at AGENTS.md task-protocol step 5 ("Finish"), when asked to land, queue, merge or auto-merge a PR, or before pushing to a PR that already has auto-merge on.
---

# Land a PR

AGENTS.md § Task protocol, step 5 ("Finish"): the owner lands T2 and any PR
without an eligible report. An agent may queue a T0 or T1 PR only once the
owner's landing settings are in effect and every check below holds for the
exact current head SHA. This skill is that check, then the two commands.
The first step tells you in one read whether agents may queue at all; when
they may not, the owner lands.

`node scripts/land-pr.mjs <pr>` reads every fact below with GET requests and
prints one line per gate, `ok` or `FAIL`, then the verdict. It prints the
commands only when all seven gates are `ok`. It never runs them. Those
commands are `gh` commands that run on GraphQL, which a Claude Code session
refuses: read "In a Claude Code session" below before you run any of them.

## Steps

1. **Check whether agents may queue at all. If not, stop: the owner lands.**
   Agents may queue only after #5605 rows 3 and 6 and #5500 are in effect
   (D5605, D5607). Read them from what GitHub reports, not from the issues'
   prose:
   - Row 3 (auto-merge and update-branch on): `GET /repos/AxalNetwork/StudioOS`
     returns `allow_auto_merge: true` and `allow_update_branch: true`.
   - Row 6 (T0/T1 land automatically): the repository variable `LANDING_AUTO`
     is `true`. The variables API is closed to this session's proxy, so read
     it where the workflow prints it: the env block of your PR's
     `landing policy` job log shows `LANDING_AUTO: true`.
   - #5500 (queue admission enforced and proven): the issue is closed as
     completed.

   Read all three every time; their state is not recorded here. If any
   fails, the gate `agents may queue` prints `FAIL`.
   Do not queue, do not mark the PR ready to make it land, and post a STATUS
   with `state: READY_FOR_REVIEW` that says "green; the owner lands".
2. **Run the gates.** From any checkout of this repository:
   `node scripts/land-pr.mjs <pr>`. It checks, in the order it prints them:
   - **agents may queue**: step 1.
   - **PR open on main**: open, not merged, base `main`.
   - **main requires the merge queue**: `GET /repos/AxalNetwork/StudioOS/rules/branches/main` has a `merge_queue` rule.
   - **landing-policy.yml untouched**: no entry of `GET /pulls/<pr>/files` has `filename` or `previous_filename` equal to `.github/workflows/landing-policy.yml`. A PR that edits the workflow cannot vouch for its own report.
   - **required checks green**: every context in the main rule's `required_status_checks` (today `test:drift (full suite)`, `worker (typecheck)`, `frontend (build)`, `api ↔ worker drift`, `applied migrations unchanged`, `scan`) has a check run on the head SHA, completed with `success`. Skipped, neutral, pending or missing is not green.
   - **landing policy T0/T1 for this head**: see "Reading the landing policy report" below.
   - **merge queue not stalled**: no open issue titled `[alert] merge queue stalled` (D5604).

   Add `--json` for machine-readable output. Any `FAIL`, or a fact listed
   under `unread:`, means the owner lands.
3. **Queue, only if the verdict is `queue`.** Run exactly what it prints,
   in order, with `gh`:
   - `gh pr ready <pr>` (only if the PR is still a draft: GitHub does not merge drafts, D5607);
   - `gh pr merge <pr> --auto --squash --match-head-commit <sha>`, where `<sha>` is the head SHA the gates were checked on. `--match-head-commit` makes GitHub refuse if the head moved.

   In a Claude Code session both commands fail with HTTP 403 (no GraphQL).
   Do not queue there by another route: post the STATUS and the owner lands.

   Then set `state:review` if it is not already, and post a STATUS that names
   the tier, the head SHA and the landing policy run link the script printed.
4. **Before you push anything to a PR with auto-merge on**, turn it off
   first: `gh pr merge <pr> --disable-auto`. In a Claude Code session that
   command fails with HTTP 403; use the session's REST route instead,
   `DELETE /repos/AxalNetwork/StudioOS/pulls/<pr>/ccr/auto_merge`, then
   `GET /repos/AxalNetwork/StudioOS/pulls/<pr>` and confirm `auto_merge` is
   `null`. If that fails too, or the PR page shows it in the merge queue,
   do not push: ask the owner to disable auto-merge or remove it from the
   queue, and wait. Then push, wait for a new `landing policy` report on the
   new head, and start again at step 1. The script prints the `gh` command
   under `before any push to this PR:` whenever auto-merge is on.
5. **After the merge**, follow AGENTS.md § STATUS: post `DONE` once, and
   release the claim with `node scripts/claim.mjs release <issue> --slot <SLOT>
   --agent <AGENT> --session <SESSION>`, the same identity you claimed with.

## Reading the landing policy report

`.github/workflows/landing-policy.yml` runs on every `pull_request` to
`main`. Its job, `landing policy`, checks out the event's base SHA, fetches
the PR head without checking it out, confirms the fetched SHA equals the
event's head SHA, and runs the **base's** `scripts/merge-policy.mjs --base
<base> --head <head>` (D5607). Missing trusted code, a moved head or an
unreadable diff reports T2. The check is advisory and not required, and it
normally concludes `success` whatever the tier: its conclusion says nothing
about the tier.

The result is written to the run's step summary:

```text
## Landing policy (advisory)
Base SHA: `<base>`
Head SHA: `<head>`
LANDING_AUTO: `true|false`
    {"tier":"T0|T1|T2","reasons":["T1: route, service, or page: <path>", ...]}
```

Eligible means all three: `Head SHA` equals the PR's current head, `LANDING_AUTO`
is `true`, and `tier` is `T0` or `T1`. The highest tier across all files wins:

- **T0**: `documentation/**`, a newly added test file, `frontend/src/{components,icons,styles}/**`.
- **T1**: `cloudflare-worker/src/{routes,services}/**`, `backend/app/{api/routes,services}/**`, `frontend/src/{routes,services,pages}/**`.
- **T2**: everything else, including `.github/`, `scripts/`, `.claude/`, `cloudflare-worker/sql/`, `cloudflare-worker/src/middleware/`, `package*.json`, lockfiles, `wrangler*.toml`, `AGENTS.md`, `CLAUDE.md`, any path whose name mentions auth, session, billing, payments, pricing, OAuth and the rest of `SENSITIVE_NAME` in `scripts/merge-policy.mjs`, edits to existing tests, removed tests or assertions, added `skip`/`todo`/`only`, and timeout, baseline, ledger or shard changes.

The step summary is not returned by the REST API or by `gh`. Read it on the
run page (the script prints its link), or let the script reconstruct it: the
job log's env block carries `BASE_SHA`, `HEAD_SHA`, `PR_NUMBER`,
`LANDING_AUTO` and `CHECKOUT_OUTCOME`, and the script then runs `git fetch
--no-tags origin <base> refs/pull/<pr>/head` and the base's own
`merge-policy.mjs` on the same two SHAs, the computation the workflow ran. If
the run page and the script disagree, the run page wins; if you copied the
summary into a file (the rendered page text or the raw markdown both work),
pass it with `--summary <file>` and the script uses it instead. `--no-classify` skips the recompute (the tier gate then fails).

`scripts/lib/prTier.mjs` is a different "tier": it picks a thin or full CI
test run (D5621). It has nothing to do with landing.

## In a Claude Code session

`gh pr ready`, `gh pr merge --auto` and `gh pr merge --disable-auto` run on
GitHub GraphQL. A Claude Code session refuses GraphQL: each fails with
`HTTP 403: GitHub GraphQL is not available from Claude Code sessions`, even
when `gh` is installed and signed in. The 403 names REST replacements under
`/repos/{owner}/{repo}/pulls/{n}/ccr/` (`PUT` or `DELETE .../ccr/auto_merge`,
`POST .../ccr/ready_for_review`). Use them like this:

- **Queueing (`PUT .../ccr/auto_merge`, `POST .../ccr/ready_for_review`):
  do not.** The route has no equivalent of `--match-head-commit`, so the
  decision is no longer bound to the head SHA the gates were checked on. In
  a Claude Code session the owner lands, even when every gate is `ok`.
- **Turning auto-merge off before a push (`DELETE .../ccr/auto_merge`):
  allowed**, as in step 4. It only takes a PR out of landing. If it fails,
  ask the owner and do not push.

## Without gh

`gh` may also be missing or unauthenticated. Every fact is
readable with `curl -sS` GETs to `https://api.github.com` plus the path below,
through the session proxy (the script does exactly this, with `gh()` from
`scripts/coordinator.mjs`):

| Fact | GET |
|---|---|
| Row 3 settings | `/repos/AxalNetwork/StudioOS` → `allow_auto_merge`, `allow_update_branch` |
| #5500 (and #5605 for context) | `/repos/AxalNetwork/StudioOS/issues/5500` → `state`, `state_reason` |
| Merge queue and required contexts | `/repos/AxalNetwork/StudioOS/rules/branches/main` → `merge_queue`, `required_status_checks` |
| Head SHA, draft, auto-merge | `/repos/AxalNetwork/StudioOS/pulls/<pr>` → `head.sha`, `draft`, `auto_merge` |
| Files | `/repos/AxalNetwork/StudioOS/pulls/<pr>/files?per_page=100` |
| Check runs | `/repos/AxalNetwork/StudioOS/commits/<sha>/check-runs?filter=latest&per_page=100` |
| Landing policy log | `/repos/AxalNetwork/StudioOS/actions/jobs/<check run id>/logs` (follow the redirect: `curl -sSL`) |
| Alerts | `/search/issues?q=repo:AxalNetwork/StudioOS+is:issue+is:open+in:title+%22%5Balert%5D%22`, then match the title exactly (the search also returns issues that merely mention "alert") |

Marking ready and enabling auto-merge are writes. Without a working `gh`,
do not make them with raw API calls, the `ccr` routes included: post the
STATUS and leave the landing to the owner. The one write you may make
without `gh` is the step 4 `DELETE .../ccr/auto_merge`.

## Rules

- Queueing is the owner's unless every gate holds. Any doubt, unread fact or
  `FAIL` means the owner lands. The owner always lands T2.
- Never `--admin`. Never push to `main` or to another slot's branch. Never
  approve your own PR (#5569). Never enable auto-merge or merge with `gh pr
  merge` unless both `--auto` and `--match-head-commit <sha>` are set;
  `--disable-auto` is the only other form allowed.
- One head, one decision: a push invalidates the report. Disable auto-merge
  and leave the queue before pushing, then wait for a new eligible report.
  Never push to a PR whose auto-merge you could not turn off.
- While `[alert] merge queue stalled` is open, add no new queue entries
  (D5604). While `[alert] main is red` or `[alert] the Actions queue is
  backed up` is open, AGENTS.md § "Red main and a backed-up queue" (D5398)
  also applies: no branch updates or re-runs to chase an inherited failure.
- The report's `pull_request` workflow runs code from the base, not your PR,
  which is why a PR that edits `landing-policy.yml` cannot rely on it.

## What it does not do

- The script never marks a PR ready, enables or disables auto-merge, merges,
  approves, pushes, re-runs or dispatches anything. It prints commands.
- It does not queue a PR from a Claude Code session (no GraphQL there).
- It does not change repository settings, the ruleset or `LANDING_AUTO`.
  Those are the owner's (D5605).
- It does not fix red checks: use the `red-ci-triage` skill for that.
- It does not replace the server-side `merge-control/policy` check planned in
  #5620.
