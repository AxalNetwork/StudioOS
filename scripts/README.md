# scripts — build, deploy, and the guards that keep CI honest

## The two you will run

| Command | What it does |
| --- | --- |
| `npm run build` | `build-frontend.mjs` — compiles the SPA into `docs/`, prerenders public routes, and prunes old hashed assets on a retention window. **Always build through this, never a bare `vite build`**: that empties `docs/` and deletes the retained assets and the hand-maintained changelogs living there. |
| `npm run deploy` | Applies pending D1 migrations (`migrate-d1.mjs --remote`) and then deploys the worker. The migration step is a `predeploy` hook, which is why deploying by hand ships the worker ahead of its schema. |
| `lib/shardPlan.mjs` | D5609: deterministic duration packing and exact-once coverage for `test-drift-parts.mjs`; tests in `lib/shardPlan.test.mjs`. |
| `baselines/` | D5613: split auth-inventory and SQL-prepare ledgers, each directory with its own README. |

## The guards

| File | Purpose |
| --- | --- |
| `plan-network-directory.mjs` | D7672: offline planner for reviewed Airtable/Folk source snapshots; creates a restricted parameterized import plan outside the repository and reports aggregate counts; never contacts a database. |

`npm run test:guards` runs every `check-*.mjs`. They exist because each one
represents a bug that reached production once:

| Guard | What it catches |
| --- | --- |
| `ci/no-anthropic-in-prod.mjs` | D5339: the production Personal Advisor import graph cannot reach D851's provider runner or adapters; Anthropic references stay in an explicit reviewed allowlist; `/api/assistant` stays behind its non-production, exact-flag mount gate. Runs in `test:guards`; fixture and mutation coverage lives in `lib/noAnthropicInProd.test.mjs`. |
| `ci/test-tracer.mjs` | D5608: opt-in Node test dependency and timing preload. Set `TEST_TRACE_DIR` when invoking a suite part to record repo-relative paths, probes, subprocess visibility and wall time. |
| `ci/test-tracer-hooks.mjs` | D5608: the tracer's off-thread module hooks — report each resolved repo module over a MessagePort and send `node:sqlite` through the shim. Off-thread because a synchronous `registerHooks` hook changed what `_deck-loader.mjs` tests rendered. |
| `ci/test-tracer-sqlite.mjs` | D5608: `node:sqlite` with a `DatabaseSync` that records each file database a traced test opens. |
| `ci/merge-test-deps.mjs` | D5608: merges process traces into commit-level dependency and timing JSON, reports untraced tests and counts opaque ones. |

## The one rule that needed a linter

`npm run lint:undef` — ESLint over `frontend/src/**/*.{js,jsx}` with everything
off except **`no-undef`**. It is not a `check-*.mjs` and so is not in
`test:guards`; `test:drift` runs it directly.

It exists because `check-react-hook-imports.mjs` says in its own header why it
cannot be the whole answer: *"A general undefined-identifier check is a linter's
job and would need real scope analysis to avoid false positives."* The case it
misses is **a name declared in one component and read in a sibling** —
`FounderGrowFocus.jsx` had three (`metCount`, `measured`, `readTargets`)
declared in the host and read in `FocusContent`, which blanked `/grow/focus`
with a `ReferenceError` at render. An undefined identifier is a runtime error,
not a build one, so Vite bundled it without complaint: two were found by CodeQL
and the third by a browser. Writing the scope analysis that separates those
cases by hand is writing a linter, so this is a linter with one rule.

Its first run found two live bugs — `StartupList.jsx`'s empty-state button
called a `setShowForm` the refactor had removed (the only branch that ever ran,
so every new account with no startups got the `ReferenceError`), and
`SpinoutLabPage.jsx` read an unimported `LAB_APPLY_HREF`. Config and the
reasoning behind what it deliberately leaves off are in `eslint.config.mjs`.

**The SPA's other 27 files are covered by `npm run test:types:frontend`, not by
this.** The glob is `{js,jsx}` because espree cannot parse TypeScript, so
`frontend/src`'s 27 TS and TSX files needed a compiler rather than a linter.
They have one since #201 (D96): `frontend/tsconfig.json` + `tsc --noEmit`,
chained into `test:drift` beside the worker's `test:types`. It catches the same
bug class with the same force — a deleted `import { Editable }` fails it by file
and line — which means `check-react-hook-imports.mjs` no longer has any unique
cover, and is kept for its message alone. D84 recorded that gap as open; D96
closes it and says what changed.

## The compiler that covers what the linter cannot parse

`npm run test:types:frontend` — `tsc --noEmit -p frontend/tsconfig.json`. Like
`lint:undef` it is not a `check-*.mjs`; `test:drift` runs it directly, next to
the worker's `test:types`.

Added by #201, and the thing worth carrying forward is that **strict was the
cheap option**. Measured over exactly those 27 files: fully loose reports 15
errors, `noImplicitAny` alone 18, strict 10, strict + `allowJs` **9**. Loose mode
reads `data.features[idx] ?? {}` in `demo_day_app.tsx` as narrowing to the empty
type and files seven complaints against a defensive fallback that is already
correct; `strictNullChecks` makes all seven vanish. The nine were fixed rather
than tolerated — see D96 for what each one was.

**`docs/` digests are not a valid before/after test for a build change.**
`build-frontend.mjs` keeps a rolling asset-retention window, so hashing all of
`docs/` moves on every run even with identical input — it says a build "changed"
when nothing did. Adding `frontend/tsconfig.json` had to be checked for exactly
that (Vite reads a project-root tsconfig for `jsx`/`target`), and the way to do
it is two `vite build --outDir <tmp>` runs, with and without the file, compared
file by file. They came out byte-identical.

## The live probes

These reach **production over the network**, so none of them is in
`test:guards` or `test:drift`: a check that cannot run inside the suite must
never sit in the suite reporting success. All but one run in a workflow of
their own — three on a schedule, `check-baseline-drift.mjs` as the deploy
workflow's last step; `pitch-acceptance-live.mjs` is run by hand — and each has
unit tests over its pure helpers that *are* in the suite.

The probes: `check-spa-live.mjs`, `check-magic-link-canary.mjs`,
`check-magic-link-insert.mjs`, `check-magic-link-live.mjs`,
`check-baseline-drift.mjs`, `pitch-preflight-acceptance.mjs` (with its page,
`pitch-preflight-acceptance.entry.jsx`), `pitch-acceptance-live.mjs`, and
`capture-spa-previous.mjs`; each describes itself in [the generated list](#the-files) below.

## The deck harness

`eval-elements.mjs` and `check-prompt-eval.mjs`; each describes itself in [the generated list](#the-files) below.

## The pull-request preview

`pr-preview-worker.mjs` and `check-preview-artifact.mjs`; each describes itself in [the generated list](#the-files) below.

## Deploying a branch

| File | What it does |
| --- | --- |
| `migrate-d1.mjs --branch <code>` | Migrates one subsidiary's database (`studioos-<code>`) instead of production, through the generated config that declares it. `--bootstrap` is allowed here and refused for production: a freshly created branch database is empty, which is what `branch-provision.yml` builds from the baseline. Target selection is `lib/migrationTargets.mjs`. |

The scripts: `write-branch-registry.mjs`, `seed-branch-principal.mjs`,
`open-branch-link-pr.mjs`, `gen-branch-wrangler.mjs`,
`list-deployable-branches.mjs`; each describes itself in [the generated
list](#the-files) below.

## Reading a design artifact

`read-canvas.mjs`; each describes itself in [the generated list](#the-files) below.

## Data importers

An importer is a committed script that **writes a migration** and never opens a
database (D537). The rows reach D1 through `migrate-d1` after review, and every
row carries its source, the record's own URL, the licence and the date of the
pull.

The importers: `import-wikidata-companies.mjs`, `import-sec-edgar.mjs`,
`import-companies-house.mjs`, `import-research-funds.py` and
`import-global-research-funds.py`. The generators
once listed here (`build-api-index.mjs`, `build-route-registry.mjs`,
`build-generated.mjs`, `build-rail-matrix.mjs`) are not importers. Each
describes itself in [the generated list](#the-files) below.

## Subfolders

| Folder | What lives there |
| --- | --- |
| `lib/` | Shared helpers (`migrationPlan.mjs`, `assetRetention.mjs`, `sourceTreeHash.mjs`, `branchConfig.mjs`) and their unit tests — `npm run test:retention` runs every `*.test.mjs` here. |
| `perf/` | #4573's performance baselines, all local and read-only: `bundle-baseline.mjs` (the built shell's critical path and each lazy chunk's cost beyond it, raw/gzip/brotli), `vitals-local.mjs` (lab LCP/FCP/CLS for the anonymous pages in a local Chromium, `/api` stubbed) `api-bench.mjs` (D1 statements per API flow through the whole Worker; run under the Worker's TS loader) `community-bench.mjs` (the Community overview at 4, 12 and 52 weeks and Recent activity on a large synthetic community, #4717 package 5; same loader) and `security-bench.mjs` (HQ Security's ledger and Overview on a large synthetic ledger, with and without the evidence indexes, #4708 part 2; same loader). The baseline they produced is `documentation/audits/PERFORMANCE_BASELINE_2026-11-06.md`. |
| `fixtures/` | Small inputs for the importers. `shai-goldman-sample.csv` has the third fund list's shape and no real row from that list. |
| `ci/` | CI evidence, provider boundaries and verified tool acquisition; see its README. |
| `og-assets/` | Open Graph image sources. |
| `claude-review/` | The advisory pull-request review on the Anthropic Messages API (`claude-review.yml`): `review.mjs`, its own `package.json` pinning the SDK, and `rates.json`. Its rules live in `lib/claudeReview.mjs`. |
| `landing-bot/` | #6467: the landing bot's shared rules (`rules.mjs`: mode, eligibility, breakers, attempts, budgets, the path guard, give-up text) and `workflowGuard.mjs`, the helper each bot workflow's test calls. No workflow; tests in `frontend/test/landing_bot_core_6467.test.mjs`. |
| `__pycache__/` | Python bytecode. Not source. |
| `scan-remediation/` | D6935: reconcile default-branch Code Scanning alerts, trackers, suggested fixes and draft PRs. |
| `perf/worker-bundle-baseline.mjs` | D4574 H3: where the Worker script's bytes come from, from the metafile `wrangler deploy --dry-run --metafile` writes: the script's raw, gzip and brotli size, and its bytes by `src/` folder, npm package and largest input. Local and read-only. |

## The files

<!-- index: generated -->

Every script here describes itself in its own header comment: a leading
`/** … */` or `//` block for a module, a leading `#` block (after the shebang)
or a module docstring for a shell or Python file. The list below is generated
from those headers (#6470, as #4104 does for routes and services): `node
scripts/check-folder-docs.mjs --write` fills it in your working tree and
`--clean` empties it; it is never committed. So a new script needs a header
comment and no edit here, and a script without one fails the build. A data
file here (`*.json`, `*.txt`) takes no comment and is not listed: the script
that reads or writes it describes it in its header (`flaky-tests.mjs` for
`flaky-tests.json`, `check-runtime-ddl.mjs` for `runtime-ddl-baseline.json`,
`check-test-clock.mjs` for `test-clock-allowlist.txt`, `lib/hubFreeze.mjs`
for `hub-freeze.json`).

<!-- files:begin -->
<!-- files:end -->

## Adding a guard

Write the failure first — a guard that cannot fail on the bug it was written for
is decoration. Several here were rewritten after passing cleanly over the exact
code that motivated them.

## Meeting bot image pipeline (#2586, D886 B8)

`build-meeting-bot-image.mjs` builds the future B2 runtime context
(`meeting-bot/`) only when its Dockerfile and ignore file both exist.
`lib/meetingBotImage.mjs` validates repository/commit metadata and forms
Docker argument arrays; its test uses a stub runner to check failure ordering.
The image helper performs no migrations, deployment, login or publication.
`--fixture` builds a scratch image solely to smoke-test CI plumbing; it emits
no publishable image output and contains no bot runtime.

## Daily release drafts (the version beside the logo)

`release-draft.mjs` reads the complete first-parent commit history of
`origin/main`, using UTC committer dates to identify when changes landed on
main. Each active day gets one release draft targeting that day's final main
commit. Titles show the version alone, without dates or descriptions.
The version counts active months since the start; week/day counters reset
each month. Active seven-day blocks within the month (1–7, 8–14, etc.)
produce a zero-based week counter, 0–4. Active days count 1–31. Empty
blocks/days add nothing. October 23 with activity every day is v8.3.23-alpha: every tag
carries the stage, `RELEASE_STAGE` in `frontend/src/lib/release.js`. Publication dates
are not used to date historical releases.

All release pages are read before writing. A daily marker associates the
release with its commit day. Only matching drafts refresh; unchanged drafts
need no write. Published daily releases and tags are frozen. Existing legacy
releases and unrelated drafts are untouched. A conflicting unrelated tag
fails rather than being overwritten. Writes are paced for GitHub's secondary
content-creation limit. `--dry-run` plans without writes or waits.

The workflow checks out full history (`fetch-depth: 0`). Publishing stays
manual; no publishing or deploy is performed by this generator. Notes link
the exact comparison from the previous active day's final commit to this
one. Publishing still triggers `release-published.yml` for the logo badge.
`lib/releaseDraft.test.mjs` covers the date counters, historical backfill,
pagination, fixed published versions and idempotent draft updates.

`release-alpha-rename.mjs` is a one-off. #2655 dropped the stage suffix, so
v1.0.1 to v8.3.26 were released without `-alpha`. Run by hand through
`release-alpha-rename.yml`, it gives each published one a suffixed tag on the
same commit as its old tag and moves the release onto it; drafts only change
name. It publishes nothing, refuses a suffixed tag that already belongs to
another release or commit, keeps the old tags unless `--delete-old-tags`, and
`--dry-run` lists the plan without writes. `lib/releaseAlphaRename.test.mjs`
covers it.

`deck-dry-run.mjs` (D1509, #3760) reads an owner-exported D1 dump into an in-memory SQLite and compares every current deck as Present draws it today with The Grid's draw (a fields card through the editor's conversion; every block against the grid and its text capacity). It lists each difference as explained (`converted`, `placeholder`) or not, by deck id, version, card and kind only, writes nothing, and exits 1 on any unexplained one. Run it as `node scripts/deck-dry-run.mjs <backup.sql> [--all-versions] [--json]`.

`dry-run-meeting-bot-deploy.mjs` validates only the separate bot Worker configs
with an isolated scratch image; Docker is required. It never deploys.
`lib/meetingBotDeploy.test.mjs` protects independent site releases, remote
binding targets and branch isolation.

`configure-meeting-bot-binding.mjs` prints the prospective site config and topology catalogue; only
`--write` changes it, after the owner deploys both bot hosts. Its pure helper
`lib/meetingBotBinding.mjs` adds all three remote bindings and the HQ-only catalogue entry idempotently.

`check-meeting-bot-teams.mjs` (D5815, #5815) checks the Teams recorder's
deployment matrix offline: each environment's site → host binding, run-state
object, private chunk bucket, callback origin, signing audience, container,
pinned browser, readiness/egress, revision order and switch values. It prints
`pass`/`FAIL` per row, never a value. `lib/meetingBotTeamsMatrix.test.mjs` fails
each row on its own mutation.

## Review harnesses

Each harness describes itself in [the generated list](#the-files) below.

D5676: `check-tail-archive.mjs` is an external authenticated metadata-only observer check; query/process fallback belongs to the shared independent monitor owner.

D5675: `verify-meeting-bot-preview.mjs` validates the deployed preview receipt before normal production promotion, retaining sanitized stage evidence.



| `scan-remediation/` | D6935: reconcile default-branch Code Scanning alerts, trackers, suggested fixes and draft PRs. |
| `build-r2-inventory.mjs` | D6650: read-only typed R2 mutation inventory and classification/provenance guard; `--write` renders the generated, gitignored Markdown inventory beside the policy JSON. |
| `check-record-writes.mjs` | D6651: fails on a put or delete of a `record` R2 prefix outside `cloudflare-worker/src/services/recordStore.ts` (writes) and `cloudflare-worker/src/services/recordErasure.ts` (deletes); baseline `record-writes-baseline.json` started empty. |

| `file-recovery.py` | D6428: approved-class-only, lock-verified R2 snapshots and suppression-required restore primitive; live activation waits for counsel/#6650/#6654. |
| `file-recovery-drill.py` | D6428: synthetic-only archive/source-loss/restore/suppression drill, with no provider access. |
| `file_recovery_6428_test.py` | D6428: synthetic registry, lock duration, archive immutability, corruption, copy failure and suppression regressions. |
| `report-incorporation-state.mjs` | #6684: read-only incorporation state by jurisdiction id (orders by status, a Stripe one-time price yes/no, template bodies and counsel approvals, ids outside the six, multi-paid projects, a US beneficial-ownership step); counts and yes/no only. |
| `check-production-credentials.mjs` | D7145 checks each workflow job against the production credential inventory and enforces its environment. |
| `verify-production-environment.mjs` | D7145 release preflight that requires the exact main-only production deployment policy before credentials are used. |
| `import-global-funds.py` | D7325: offline validator and duplicate-safe SQL generator for primary-source fund-manager research; `--check` verifies the committed migration. |

| `local-files.mjs` | D7255: descriptor-bound regular file reads/edits and private, no-follow operator-state files; rejects symlinks and hard links before truncation. |

| `file-recovery-independent.py` | D6653: encrypted independent snapshots, private run heartbeats and synthetic-only outside-preview restore proof. |
| `file_recovery_6653_test.py` | D6653: fixtures for independent integrity, isolated credential roles, unconfigured skips and failure heartbeats. |

| File | Role |
| --- | --- |
| `guard-commands.json` | D5505: the single ordered guard command/flag catalog, preflight selection and prerequisite metadata. |
| `run-guards.mjs` | D5505: full `npm run test:guards`, advisory `npm run test:guards:preflight`, and `--guard <id>` reproduction; emits bounded guard results. |
