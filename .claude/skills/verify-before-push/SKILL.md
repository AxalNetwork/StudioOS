---
name: verify-before-push
description: Run StudioOS's local checks before pushing a branch or marking a PR ready, in steps that each finish inside one session. Use when about to push, when `npm run test:drift` is too long for the session or hit its time limit, when choosing which tests a change needs, or when a local failure may come from the environment (missing node_modules, docs/ not built, case-insensitive imports) rather than the PR.
---

# Verify before push

The full local suite, `npm run test:drift`, takes longer than one session
allows. This skill runs the same checks as CI, in steps that each finish,
and keeps every exit code.

Read `AGENTS.md` § House rules (the **Tests** bullet) and § Red main first.
They win where this file disagrees.

## What CI runs

`.github/workflows/ci.yml` on a pull request:

| CI job | What it runs | Local step |
|---|---|---|
| `frontend (build)` | `npm run build` | `build` |
| `worker (typecheck)` | `node ../scripts/build-generated.mjs`, then `npx --no-install tsc --noEmit` in `cloudflare-worker/` | `types` |
| `suite plan` | `node scripts/test-drift-parts.mjs --plan test-timings.json`, weighted by main's timings | `suite-plan` (equal weights) |
| `suite (<part>)` | `npm run build`, then `node scripts/test-drift-parts.mjs <part> --plan-file suite-plan.json` | one step per part |
| `test:drift (full suite)` | passes when every `suite (<part>)` passed | all parts |
| `ci / fast` | gitleaks, `migration-immutability-gate.mjs`, `lfs-size-gate.mjs`, `check-api-drift.mjs`, worker `tsc`, frontend build, npm audit, pip-audit, `build-profile-routing.mjs --check` | `migrations`, `lfs`; the rest are inside `guards` and `types` |
| `api ↔ worker drift` | `node scripts/check-api-drift.mjs` | inside `guards` |
| `open graph metadata` | `node scripts/prerender-og.mjs --check`, `node scripts/generate-og-images.mjs --check`, `node scripts/validate-og-tags.mjs` | not run; run these by hand after changing a public page's title or meta |
| `dev backend (import smoke)` | imports `backend.app.main` and two `unittest` files | not run; see the job if you touched `backend/` |
| `editor visual regression and axe` | Playwright in a pinned container | not run locally |

The parts are `test-drift-parts.mjs --list`: `frontend-1-of-2`,
`frontend-2-of-2`, `worker-1-of-6` to `worker-6-of-6`, and `rest`. `rest` is
every other step of `test:drift`: `test:meeting-bot`, `test:merge-control`,
`test:retention`, `test:guards`, `test:types`, `test:types:frontend`,
`lint:undef` and `node scripts/check-dark-mode.mjs` (D5609). Locally the plan
has no timings file, so it uses equal weights: a local `worker-3-of-6` holds
different files from CI's `worker-3-of-6`. Compare failures by test file, not
by part name.

## Steps

Work from the repository root of your branch's worktree. Keep logs out of the
repository: pass a folder in your scratchpad as `LOG`.

1. **Dependencies.** `node_modules` must exist in the root, `frontend/` and
   `cloudflare-worker/`. In a scratch worktree on a tight disk, link them from
   a full checkout instead of `npm ci`:
   `ln -s <checkout>/node_modules node_modules`, and the same for
   `frontend/node_modules` and `cloudflare-worker/node_modules`. All three are
   gitignored. Remove the links when you remove the worktree.
2. **Base.** `git fetch origin main`, so the merge base is current.
3. **Plan.** `node scripts/verify-before-push.mjs plan --log-dir LOG` prints
   the steps for this change, in order, with each command, why it is there and
   its timeout. It reads the changed files from `git diff` against the merge
   base with `origin/main` (`--base <ref>` for another), plus uncommitted and
   untracked files. `--files a,b` plans for a given list instead. It prints a
   `note:` for each environment problem it can see before running anything.
4. **Run, in calls that finish.** One call per group of steps. Copy the ids
   from your own `plan` output: `--only` refuses an id that is not in this
   change's plan (exit 2), and a worker-only change has no `types-frontend`,
   `lint-undef`, `dark-mode` or `affected-frontend`. The helper has no `rest`
   step: it splits `rest` into its own steps (`guards`, `types`, `retention`
   and the others below).
   - `node scripts/verify-before-push.mjs run --log-dir LOG --only generated,build,guards`
   - then the static steps and the affected tests your plan lists, e.g. for a frontend change `--only types-frontend,lint-undef,dark-mode,lfs,affected-frontend`
   - then one part per call, e.g. `--only worker-3-of-6`. A part needs the plan, so `--only` adds the `suite-plan` step in front of it.
   - or `--from <id>` to run from a step to the end.

   Run a part with the Bash tool's `run_in_background` and wait for it; never
   start two parts at once on a small machine. Times measured in a cloud
   session on 2026-11-14: `build` 21 s, `guards` 166 s, `lint-undef` 26 s,
   `retention` 43 s, `meeting-bot` 39 s, `frontend-1-of-2` 10 minutes,
   `worker-1-of-6` 17 minutes. All eight parts in one call would not finish. Each step has its own timeout
   (30 minutes for a part; `--timeout-min N` overrides it) and is killed with
   its whole process group when it runs over. `--stop-on-fail` stops at the
   first failure; without it every chosen step runs. A failed `generated`,
   `build` or `suite-plan` always stops the run, because every later step needs
   it.
5. **Read the summary.** `node scripts/verify-before-push.mjs summary --log-dir LOG`
   prints every step's status, exit code, time and log, and a STATUS `tests:`
   line. That line counts against the whole plan (`N/M planned steps exit 0`)
   and ends with `not run: …` for every planned step that has no current
   result. Results add up across calls. A result from an earlier tree (another
   commit, or a later edit) shows as `STALE`: run that step again before you
   report it.
6. **Before marking the PR ready,** run every part once on the final tree:
   `run --full --log-dir LOG`, in the same per-part calls. `--full` plans
   exactly what `npm run test:drift` runs, plus the migration and LFS gates.

The same steps by hand, with the exit code taken from `echo`, never through a
pipe (AGENTS.md § House rules, **Tests**):

```sh
node scripts/build-generated.mjs
npm run build > LOG/build.log 2>&1; echo EXIT=$?
npm run test:guards > LOG/guards.log 2>&1; echo EXIT=$?
node scripts/test-drift-parts.mjs --list
node scripts/test-drift-parts.mjs --plan LOG/no-timings.json && mv suite-plan.json LOG/
node scripts/test-drift-parts.mjs worker-1-of-6 --plan-file LOG/suite-plan.json > LOG/worker-1.log 2>&1; echo EXIT=$?
```

`--plan` always writes `suite-plan.json` at the repository root and that file
is not gitignored, so move it out; never commit it. The helper does this for
you.

## Which steps a change needs

`scripts/lib/verifyBeforePush.mjs` decides it. Always: `generated`, `build`,
`guards`, `lfs`.

| Changed | Adds |
|---|---|
| `frontend/` | `types-frontend`, `lint-undef`, `dark-mode`, the frontend parts |
| `cloudflare-worker/` | `types`, the worker parts |
| `cloudflare-worker/sql/` | `types`, `migrations`, the worker parts |
| `meeting-bot/` | `meeting-bot`, and `types`: `cloudflare-worker/tsconfig.json` also type-checks `meeting-bot/worker/` |
| `merge-control/` | `merge-control` |
| `scripts/` | `retention` |
| `documentation/`, `design/`, `*.md`, `.claude/` | nothing more |
| `package.json`, a lockfile, `.github/`, `wrangler.toml`, a `tsconfig`, `eslint.config.mjs`, a test loader or `_` helper, a generator, an unknown path | everything (`--full`) |

The `affected-*` steps run the test files that import a changed file,
following relative imports from `testFiles()` and `importGraph()` in
`scripts/select-tests.mjs`. That is a quick first signal, not a selection:
many tests read source files as text and are not found this way. When a
runner has more than 150 affected test files, its `affected-*` step is shown
as skipped and that runner's parts join the plan instead, whatever area
changed: a change to `frontend/src/lib/money.js`, which worker services
import, then plans the worker parts. D5610 makes
selection advisory, and CI still runs every part. `node scripts/select-tests.mjs`
itself needs CI's `test-deps.json` trace and `BASE_SHA`; without them it
records `mode: full`, so it does not narrow anything locally.

Order matters. `build` comes before `guards`: `test:guards` is one `&&` chain,
and without `docs/` it stops at `check-docs-assets-closure`, so the checks
after it (`check-bundle-budget`, `check-frontend-builds` and the rest) never
run (D529). `generated` comes first because the generated modules are not
committed (D5612). A bare `tsc` or `node --test` does not run the npm
`pretest:*` hook that writes them.

## Failures that are not the PR's

When a failed step's log matches one of these, the helper prints `env:<code>`
under the step. The tag is a hint read from the end of the whole log, not a
verdict. Fix the environment and re-run that step. A tagged failure is cleared
only when the step then passes; if it fails again, read the failing test's own
output and treat the failure as the PR's.

| Code | What you see | What to do |
|---|---|---|
| `missing-deps` | `Cannot find package '…'`, `eslint: not found` | `node_modules` missing in this worktree: step 1 |
| `docs-not-built` | `check-docs-assets-closure: docs/assets/ does not exist` | run `build`, then the step again |
| `workerd-version` | a compatibility date newer than the local runtime supports | the local miniflare is older than the lockfile (#5815): `npm ci` in `cloudflare-worker/` where disk allows; CI installs the locked version |
| `age-missing` | `spawn age ENOENT` | the `age` CLI; CI installs it for the frontend parts (`scripts/ci/install-age-linux.sh`, D5398) |
| `network` | `fetch failed`, `ENOTFOUND`, `ECONNREFUSED` | weakest hint: several worker tests throw these strings on purpose (e.g. `calendar_read_health_5202`, `channels_messaging_d684`), so a real assertion failure there carries them too. Re-run once; if it fails again, it is the PR's |
| `disk-full` | `ENOSPC` | free space (old worktrees, `docs/` in other worktrees), then re-run |

Three more the log alone does not show:

- **Case-insensitive file system** (macOS, Windows). Some pairs of
  modules under `frontend/src` differ only by case, e.g.
  `pages/account/WhatsAppWayB.jsx` and `pages/account/whatsappWayB.js`. On such
  a disk an extensionless import can resolve to the wrong file, so the build or
  a test fails for a reason the PR did not cause (#6078, #5881). The helper's
  preflight names the first pair when it detects such a disk. CI runs on Linux
  and decides. Say so in STATUS; do not rename the files in your PR.
- **Live checks.** `scripts/check-spa-live.mjs`, `check-ai-credits-live.mjs`,
  `check-magic-link-live.mjs` and `check-branch-live.mjs` read the deployed
  hosts. They run in scheduled and post-deploy workflows, never on a PR:
  `post-deploy-smoke.yml` runs the SPA and AI-credits checks,
  `magic-link-probe.yml` the magic-link check, and `branch-provision.yml` and
  `cloudflare-worker-deploy.yml` the SPA check. Do not run them before a push,
  and a failure there says nothing about your branch.
- **Time.** A step that times out has not failed. Run it on its own; if a part
  still runs over, say which in STATUS rather than calling the suite green.

If a failure is none of these and also fails on a clean `main`, it is
inherited. Follow AGENTS.md § Red main and a backed-up queue (D5398): one repair
PR, no porting the fix into your branch, no merging `main` only to chase it.

## Reporting

Paste the `tests:` line from `summary` into STATUS, and the per-step table into
the PR's **Testing** section (`.github/pull_request_template.md`). Name any
step you did not run and why, and any `env:` failure. Never report a `STALE`
result or a part you did not run as passing.

## What this skill does not do

It does not push, merge, re-run CI or call GitHub. It does not decide what CI
runs: CI runs every part on every PR (D5610). It does not triage a red PR on
GitHub, and it does not mutation-check new assertions; AGENTS.md asks for that
separately.
