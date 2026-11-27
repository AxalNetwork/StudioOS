# Deploying to production

The production API and the SPA are one Cloudflare Worker (`studioos`, serving
`axal.vc`). This is the runbook for shipping it. `documentation/architecture/PRODUCTION.md`
describes *what* production is; this file describes *how to change it*.

**Audience:** whoever is at the keyboard — a person, a Replit session, or a
CI job. Every number in this document is produced by a command you run, not
written down here. That is deliberate; see [§7](#7-why-nothing-here-is-hardcoded).

---

## 1. Dispatching a release

Use an authenticated GitHub CLI from the repository root, or run **Cloudflare Worker deploy** on `main` in Actions.

```bash
npm run deploy
```

| Script | Command |
| --- | --- |
| `deploy` | `gh workflow run cloudflare-worker-deploy.yml --repo AxalNetwork/StudioOS --ref main` |

This queues a release of the dispatched `main` SHA. Follow the Actions run for the outcome. The command returning successfully means GitHub accepted the dispatch. The Worker package's own `npm run deploy` delegates to the root command.

### 1.1 Admission before production writes

For a push or dispatch, the admission job verifies the six required jobs from their expected Actions workflows on the landed `main` SHA. A missing or pending result can wait up to 95 minutes, outside the shared production release lock. Failure or an untrusted result prevents production writes.

The candidate need not be the exact `main` tip ([D8932](../architecture/decisions/D8932.md), changing D5501). Both admission checks also accept an ancestor of the tip, provided it:

- is at most 30 commits and 6 hours behind the tip;
- is not older than the version production serves, the `sha` from `GET https://axal.vc/api/public/version`.

The candidate is refused in these cases:

| Case | Status |
| --- | --- |
| Further behind the tip than the bound | `superseded` |
| Diverged from `main`, or ahead of it | `untrusted` |
| Older than the deployed version | `stale` |
| Deployed version unreadable (non-tip candidate) | `unreadable` |

The initial job skips a `superseded` or `stale` candidate; under the lock, every refusal stops the release. The evidence records `main`, `behind_by` and `deployed`. A completed CI push can use the merge-queue result through CI's exact-SHA reuse logic. A different merge-group SHA provides no proof for this candidate.

Under the lock, the release job revalidates eligibility, builds the SPA from the pinned checkout, verifies the production queue inventory, and measures the production-shaped dry-run bundle. It records the migration plan and previous Worker deployment and rechecks `main` immediately before migrations. A missing DLQ must be provisioned by the Cloudflare account owner. An inconclusive queue lookup or startup profile blocks the release. See [D5535](../architecture/decisions/D5535.md) and [D5532](../architecture/decisions/D5532.md).

The job applies pending D1 migrations, then publishes through Wrangler on the same pinned checkout. The published Worker receives the candidate in `WORKER_DEPLOY_VERSION`. The artifact records the preflight bundle digest and the resulting Worker version ID. Wrangler packages again at publication, so the digest identifies the prepared check artifact. The workflow records admission, migrations and publishing separately. Live smoke, branch rollout and schema parity remain distinct jobs.

**Provenance report (shadow, D8517).** The first admission step that runs any code of the candidate is "Report commit provenance (shadow)". It finds the head SHA of the last successful run of this workflow on `main`, lists the changes on the candidate's first-parent line since then, and for each merged pull request prints one row in the job summary: slot, task, whether `scripts/ci/agent-provenance.mjs` passes on the pull request's head (`pass`, `fail`, `human` when no commit names any identity trailer, or `unavailable`), and which session trailer each commit used (`Agent-Session` or the pre-2026-12-01 `Claude-Session`). It reads with the token the job already has (contents and actions read) and fetches `refs/pull/<n>/head`. It cannot fail the release: the step is `continue-on-error`, every command in it ends `|| true`, and the script exits 0 on any error, printing what it could not read. A missing previous deploy reports only the candidate commit. It is a report for the owner, who decides after two weeks whether it becomes a gate. Run it by hand with `node scripts/ci/agent-provenance.mjs --shadow --candidate <sha> --previous <sha>`.

### 1.2 Manual D1 maintenance

Use **D1 migrations** on `main` in Actions. Production `apply`, `baseline`, `adopt-and-baseline` and `verify-marked` take the production release lock and run both preflight checks. Wait for the exact SHA's checks to finish before dispatching a write. `dry-run` can read the plan without the write lock. The production npm migration aliases dispatch this workflow. Branch-only migration and the isolated preview retain their own targets.

Use the existing token with permission to list queues in the production account and to read the current Worker deployments, in addition to its D1 and Worker publish permissions. Privileged direct Wrangler commands can bypass workflow admission. Reserve those for the owner-controlled recovery procedure in §3.

### 1.2.1 The merge queue in front of the deploy (#4107)

A pull request reaches `main` through GitHub's merge queue. The queue tests
each entry on a `gh-readonly-queue/main/…` branch through the `merge_group`
event and merges it only when main's six required checks pass there (the
table is in `.github/workflows/README.md`, "The merge queue"). Nothing in a
queue run deploys or touches production: `cloudflare-worker-deploy.yml`
runs on a push or a manual dispatch on `main`. The queue’s merge schedules the release, which waits for the landed SHA’s evidence. A queue entry that fails is not
merged and nothing ships; the PR returns to its author with the failing check.

The queue's settings, as the owner set them on 2026-11-02 in the `main`
ruleset (Settings → Rules → Rulesets → `main` → Require merge queue):

| Setting | Value |
| --- | --- |
| Merge method | Squash |
| Build concurrency | 5 |
| Auto-merge | Off in the API; owner approved On (#5605) |
| Update branch | Off in the API; owner approved On (#5605) |
| Group size | minimum 1, maximum 5 |
| Wait time to meet the minimum group size | 5 minutes |
| Require all queue entries to pass required checks | on |
| Status check timeout | 90 minutes (`test:drift`'s own job limit; a full run took 43 to 81 minutes on 2026-11-02) |
| Require branches to be up to date before merging | off: the queue tests each entry on top of the latest `main` |

The approved bypass setting is **no bypass actors**. In an emergency the owner
edits the ruleset. See [#5500](https://github.com/AxalNetwork/StudioOS/issues/5500)
for application and exercise evidence.

Keep build concurrency at **5**. Move to **8–10** only once the measured
per-entry failure rate is **at most 3%** and run wall time is **at most 15 minutes**.
Use **2** only while the queue-stalled alert is open. This retires the
[#5506](https://github.com/AxalNetwork/StudioOS/issues/5506) concurrency pilot.
The [owner actions list](https://github.com/AxalNetwork/StudioOS/issues/1008)
tracks the settings and capacity work recorded in [D5605](../architecture/decisions/D5605.md).

To merge, press **Merge when ready**, not **Merge**.

D5606 uses two pull requests for the required check cutover.

1. Land PR 1 with the current six required checks and the shadow `landing gate`.
   Check both contexts on a PR, a merge-group run and a push. Verify that a
   changed applied migration blocks the shadow gate and an audit-only failure
   leaves its required verdict passing.
2. With an empty queue, the owner adds `landing gate` to the required checks
   and then removes the six old names. Verify the queue requires the new name.
3. Land PR 2 to remove the old jobs and workflows and update the deploy's
   expected check names. Record the first push admitted by the new gate and the
   resulting CI job count. Keep the previous names available until step 2 is
   confirmed.

### 1.3 A branch database

A subsidiary branch is a separate Worker over a separate D1 database
(`studioos-<code>`), so it is migrated separately — nothing about `main`
touches it. The same runner takes `--branch <code>` instead of `--remote`:

```sh
node scripts/gen-branch-wrangler.mjs fr        # the config the next line needs
node scripts/migrate-d1.mjs --branch fr --dry-run
node scripts/migrate-d1.mjs --branch fr
```

Or from the Actions tab: `d1-migrate.yml` with a `branch` code, which
generates the config for you. Three things differ from production, and each is
enforced rather than remembered:

- **The config comes first.** `wrangler.branch.<code>.toml` is gitignored
  build output, so it is not in a fresh checkout. The runner refuses
  `--branch` without it and prints the command above, rather than falling back
  to HQ's config and asking wrangler to resolve a database name that config
  never declared.
- **`--bootstrap` is allowed here and refused for production.** A freshly
  created branch database is empty, and `branch-provision.yml` builds it from
  `sql/schema_baseline.sql` and then migrates forward. The old rule read the
  `--remote` flag, which would have refused exactly this; it now names the
  database that must never be bootstrapped (`bootstrapRefusal` in
  `scripts/lib/migrationTargets.mjs`).
- **The baseline modes are production-only.** A branch has no legacy ledger
  to adopt; the workflow fails the run rather than doing something plausible.

Backups follow the same split: `backup-d1.yml` takes a `target_db` and now
writes to `d1/<database>/backup-<date>.sql`, so a branch backup cannot
overwrite production's restore point. `scripts/dr-drill.sh` reads both that
shape and the flat `d1/backup-<date>.sql` used before 2026-09-15, because
object lock keeps those for 365 days and they are the restore points for most
of that year.

---

### 1.4 Credentials and environments (D8069, #8069)

Every job that reads a cloud credential names the GitHub environment that holds it. `frontend/test/workflow_environments_8069.test.mjs` fails the build when one does not.

| Environment | Who may enter | Jobs |
| --- | --- | --- |
| `production` | `main` only, the owner approves | the release (`cloudflare-worker-deploy.yml` deploy, schema-drift, branches), `d1-migrate.yml`, and the merge-control, meeting-bot and archive-observer deploys |
| `production-ops` | `main` only, the owner approves | the D1 backup, the DR drill and its synthetic outside restore, file recovery (snapshot and synthetic proof), the probes, branch provisioning and the gateway jobs |
| `preview` | `main` only, no reviewer | the pull-request preview's deploy and delete (`pr-preview-deploy.yml`) |
| `agent-compute-preview` | `main` only, independent review | the disabled compute host |

The release's admission and rollback contract above is unchanged. A pull-request run enters none of these environments, so it holds no deploy credential. Each deploy and ops workflow grants no permission at the top (`permissions: {}`). Each job declares what it uses. `id-token: write` appears only on a job that exchanges the OIDC token (Claude's federation, the capacity planner, and from #8064 an AWS or Azure login).

No workflow reads a long-lived AWS or Azure key. Cloudflare has no OIDC federation, so its tokens are scoped per Worker and per environment (#8064). The preview jobs read `PR_PREVIEW_CLOUDFLARE_API_TOKEN`, not the generic name. Until the repository copy of `CLOUDFLARE_API_TOKEN` is deleted, an absent environment secret of that name would fall back to the production-capable repository token. The [credential runbook](PRODUCTION_CREDENTIALS.md) has the cutover steps and the owner gates.

## 2. Pre-flight

Run these before deploying. Read **exit codes**, not output — several of these
print warnings on success, and a grep for "error" or "fail" will lie to you in
both directions.

```bash
# The full suite reads the built SPA, and docs/ is not committed (D529):
# build first. Redirect, then read the code — never pipe this through grep.
npm run build && npm run test:drift > /tmp/drift.log 2>&1; echo "test:drift exit=$?"

# Which migration files are not safely re-runnable.
npm run d1:audit

# THE AUTHORITY on what is actually pending, checked against the live ledger.
node scripts/migrate-d1.mjs --remote --dry-run
```

`--dry-run` reads `schema_migrations` on the target and prints the plan without
writing anything. Whatever it lists as pending is what a live run will apply.
If it lists something you did not expect, find out why before continuing — but
do not compare it against a list written in a document, including this one.

It is **read-only**, which has one consequence worth knowing: the live run
creates the ledger table before reading it, and a dry run will not. Against a
database that has never been migrated by this runner, it reports
`schema_migrations does not exist on this target yet` and plans as if nothing
were applied — which, in that specific case, is the truth.

If the dry run prints the `has N table(s) but an empty ledger` warning, stop:
a live run in apply mode would refuse rather than replay history, and the fix
is the one-time `--baseline` in [§4(b)](#4-if-a-migration-fails). Any other
wrangler failure is raised, not swallowed — a connection or auth error will
never be reported to you as "nothing has been applied".

### 2.1 `docs/` is built at deploy time, never committed (D529)

`docs/` is gitignored. Every job that needs it builds it from `frontend/src`:
CI (the full suite and the Open Graph check), the PR preview, branch
provisioning, and the deploy. What a reviewer reads is the source; what ships
is that source's build, so there is no second copy to drift from it, and
`check-docs-fresh` (which compared the two) is retired.

The old-bundle window rides on a cache instead of a committed tree. A tab
opened before a deploy still asks for the previous build's hashed chunks, so
`scripts/build-frontend.mjs` keeps complete deployed generations from the last
72 hours in `docs/assets`, with at least the last three builds (including the
new build) and an
18,000-asset cap (D1364). It also retains the build that was serving before
the first deployment in that window: tabs opened just before a long-lived
build was superseded need its chunks for 72 hours too. It prunes the oldest optional generations first,
never individual chunks. If the protected floor itself exceeds the cap, it
fails the build rather than deleting the newest build's assets. A cap warning
means the time window was shortened. The full static output must also stay
under 20,000 files, including non-asset public files and prerendered shells.
If any build step fails, the wrapper restores the full previous output and
ledger, so a local retry still knows which assets were deployed.

`cloudflare-worker-deploy.yml` restores the previous successful
deploy's `docs/assets` and retention ledger from the `spa-assets-` entry in the
Actions cache before it builds, and saves them after `wrangler deploy`
succeeds. The post-deploy `record-asset-deploy.mjs` hook records the actual
successful deploy time in each new ledger entry's `deployedAt`; `ts` remains
its build time. Old ledgers receive a single conservative 72-hour grace
(`firstSeenAt`) without inventing a deployment time. Local or failed builds
do not displace deployed builds from the minimum floor. An unstamped non-legacy
entry in the successful-deploy cache is preserved under a one-time per-entry
unknown-time grace, with a GitHub warning annotation. Its deployedAt stays null until it actually ships again;
ordinary local candidates do not receive this cache-only recovery. The cache
save still runs when publication succeeded but timestamp recording failed;
that failure keeps the run red, while preserving the served tree. Failed or
skipped publication never saves a cache.

When there is nothing to restore (the first deploy, or an entry
GitHub evicted after seven days unused) the deploy still ships, the build log
says `retention restarted`, and the run carries a warning: a tab opened before
that deploy may need one reload.

A manual dispatch uses the same retained asset tree as an automatic release.
A cache miss can only preserve assets still available to the workflow. See D1364
for the measured cache budget and platform limits.

The deploy workflow also checks every lazy JS/CSS dependency after publishing
(#3590), including `/hq`'s shell on both hosts. Before the build wipes `docs/`,
`capture-spa-previous.mjs` records the restored generation's entry paths in
`$RUNNER_TEMP/spa-smoke-previous.json`. After deploying and saving the actual
deployed assets, a separate `spa-smoke` job reads both live entry bodies'
Vite maps and fetches every named JS/CSS file on `axal.vc` and `app.axal.vc`.
Tiny current/previous entry manifests are transferred from this exact deploy
run via an artifact. `SMOKE_CURRENT_BUILD` targets the newly built entry even
if live HTML is stale. Requests are bounded to 16 leaf checks at a time with
the normal retry delay between bounded waves (a mass 404 does not hold a
worker in backoff while other files wait); logs give counts and at most five failures per build
and host. Capture/transfer errors never gate publication: the smoke reports
them after deploy and still runs the existing route, API and header probes.
The sibling branch-redeploy and schema-drift jobs depend on `deploy` alone,
so smoke failure does not skip them.

The six-hour schedule remains. It restores the newest deployed cache and
selects generation 1 (the previous build), whereas the pre-build deploy
capture selects generation 0. A cache miss or a single-generation first build
is reported as previous-build coverage unavailable, never as a successful
retention check. A matched but unreadable cache fails instead of silently
dropping the previous generation. No cache or build metadata is published.
A smoke-only retry reuses this run's artifact; a full deploy retry replaces
it. Custom dispatch hosts check their live graph without production cache
hashes. The scheduled retention proof uses the last successful workflow's cached assets.
Owner-controlled recovery outside that workflow can leave its cache behind the live version.

The smoke fails the deploy run on a missing file, wrong content type or
unreadable dependency map. It never rolls production back. The owner checks
the new step on the first merged deploy; PR/local tests cannot prove that a
workflow step has already run in production. These are delivery checks, not
proof that authenticated routes render or that their JavaScript executes.

### 2.2 New bindings go in both tables

`wrangler.toml` declares every binding twice — once at the top level and once
under `[env.production]`. A binding added to only one table is missing in
whichever environment you didn't edit. `scripts/check-wrangler-binding-parity.mjs`
enforces this and runs inside `npm run test:guards`, so a green `test:drift`
already covers it.

### 2.3 AI gateways and agent settings agree across the tables (D8508, #8508)

The AI Gateway slugs (`CF_AI_GATEWAY_SLUG_*`) and the agent settings
(`AGENT_*`, `OPENAI_MODEL`, `TEAM_AGENTS_ENABLED`) are plain variables, so they
appear in `[vars]`, `[env.production.vars]` and `[env.preview.vars]`.
`scripts/check-ai-gateways.mjs` reads the three tables and the Worker's source,
and fails, naming the file, the table and the key, when:

- a value differs from `[env.production.vars]` and the script's `ALLOWED` list
  does not name that table, key and exact value with a reason;
- a path the code refuses without a gateway is switched on with an empty or
  malformed slug (an engine run without `AGENT_AI_GATEWAY`; the provider
  gateway without its own `CF_AI_GATEWAY_SLUG_PROVIDERS`);
- an agent account's model has no price (`PROVIDER_MODELS`,
  `GATEWAY_TEXT_MODELS` or `AGENT_OPENAI_RATES`).

It runs in `npm run test:guards` and as the release preflight step "Check AI
gateway and agent settings". It reads files only. To accept a new difference,
add an `ALLOWED` entry with its reason in the same PR.

The next preflight step, "Check AI gateways and the agents token on the
account" (`scripts/check-ai-gateways-live.mjs`, D8508-p2), is the live layer. It
uses the release token, as the owner chose on #8508 (answer A), and makes
read-only calls about `[env.production.vars]`:

- does each AI Gateway the table names exist;
- is `AGENT_AI_GATEWAY_TOKEN` bound to the Worker (checked by name only);
- does each account alias resolve on the `agents` gateway.

Each item is `present`, `missing` or `could not be read`. The release stops
only when an item is `missing` on a route that is switched on:

- the providers gateway, when `AI_PROVIDER_GATEWAY_OPENAI` is `on`;
- the agents gateway, its token and its aliases, when `AGENT_ENGINE` is not
  `off`.

A missing Advisor or deck gateway only warns, because the route runs without
it (owner answer A). `could not be read` also only warns. That is the state
until the release token holds **AI Gateway Read** and **Workers Scripts Read**,
which the owner grants in the Cloudflare dashboard. The step writes a table of
states to the job summary. It never prints the token, the account id or what
Cloudflare answered.

---

## 3. Capture a rollback point first

For direct owner recovery, pause new production dispatches and wait for any
in-flight release or manual D1 writer to finish before selecting the recorded
known-good Worker version. Keep the migrated schema and confirm compatibility
before resuming normal releases.

```bash
cd cloudflare-worker
npx wrangler deployments list --config ../wrangler.toml --env production
```

Record the current deployment ID **before** deploying. To roll back:

```bash
npx wrangler rollback <DEPLOYMENT_ID> --config ../wrangler.toml --env production
```

> **Rollback reverts the worker. It does not revert D1.**
> Migrations are forward-only and there is no down-migration. A rolled-back
> worker runs against the *migrated* schema, so a migration must stay
> compatible with the worker one version back. The `ALTER TABLE ... ADD COLUMN`
> style used throughout satisfies this: older code ignores columns it does not
> select. A migration that drops or renames a column does not, and needs a
> two-deploy sequence instead.

Each release records whether this rollback would be safe before it writes
anything (D7151). The step "Record the release rollback class" puts a class in
the job summary and in `rollback-class.json` in the release evidence, with the
version a rollback would return to: **`auto`** (no D1 migration, no Durable
Object migration, no binding removed), **`auto-additive`** (every pending
statement only adds a table, view, non-unique index or nullable/defaulted
column, or touches only a table the same release creates) or **`manual`**
(anything else, each reason with its file and line; anything it cannot read is
manual). The class itself changes nothing in the release, and a `manual`
release needs the compatibility check above before any rollback.

**Automatic rollback (D7152) is off by default.** The repository variable
`RELEASE_ROLLBACK_MODE` selects it; unset (or any other value) is off and the
`rollback` job of `cloudflare-worker-deploy.yml` is skipped. When it is
`report` or `act`, that job runs after `spa-smoke` under the
`studioos-production-release` lock and the `production` environment:

- If `spa-smoke` passed, or did not finish, nothing is decided. If it failed,
  the job runs the same smoke once more. A failure followed by a pass is
  flaky and never rolls back.
- Two failures on a release classed `manual` (or whose class is unreadable)
  never roll back: the job summary and an error annotation carry the class's
  reasons and the fix-forward line — check compatibility as above, or land a
  fix or a revert on `main`.
- Two failures on `auto` or `auto-additive`, while the live version is still
  the one this release published: `report` logs "would roll back to
  `<version>`" (the version D7151 recorded) and changes nothing; `act` runs
  `wrangler rollback <version>` and re-runs the smoke against the restored
  version. If the rollback or that verification fails, the job pages (it
  fails, red) and takes no further automatic action: the fault is not the
  release.
- One automatic rollback per release. An `act` rollback uploads the artifact
  `release-rolled-back-<sha>`; the deploy step "Hold a commit automatic
  rollback took off production" (act only) then refuses to publish that
  commit again unless the dispatch sets `republish_rolled_back`, and a second
  failing run of it pages instead of rolling back. The next `main` commit
  releases normally and carries the same change unless a revert or fix has
  landed.
- After an `act` rollback the restored build becomes generation 0 of the
  retention ledger with a fresh `deployedAt`, saved as a newer `spa-assets-`
  cache entry, so the next deploy treats it as the last good deploy (§2.1);
  the rolled-back build stays in the ledger, so tabs opened while it served
  still find their chunks.

Every decision is in the job summary and in `rollback-decision.json` (artifact
`release-rollback-<sha>-<attempt>`): the commit, the class, the version
published, the version restored or that would be, and the smoke rows that
failed. The owner sets `report` first, and moves to `act` only after reading
the report-only decisions of at least ten releases (#7152).

### 3.1 The window between the two writes is rehearsed on the pull request (D8532)

The release applies the D1 migrations and then publishes. If the publish
fails, the previous Worker serves the migrated schema until a retry or a
forward fix lands; a rollback puts it in the same place. The `release-window`
job of `release-rehearsal.yml` runs that window before merge, on every pull
request that changes a migration, the Worker, `wrangler.toml` or the deploy
workflow: locally, over synthetic data, with no Cloudflare account.

```bash
node scripts/release-window-rehearsal.mjs --base origin/main --out /tmp/release-window
# locally, reusing this checkout's Worker dependencies for the base tree:
node scripts/release-window-rehearsal.mjs --base origin/main --out /tmp/release-window --base-deps link
```

1. The **base** commit's schema (its baseline and migrations, every file in the
   ledger), seeded by the base Worker: an account on a paid plan with a TOTP
   sign-in, a free account holding an access grant to a project, an outsider,
   and a hashed SPA asset in the ASSETS stub.
2. The candidate's pending migrations, planned and recorded as `migrate-d1.mjs`
   does, each file as one transaction (§4c).
3. **Publish stopped.** The base commit's Worker answers a fixed set of
   requests on the migrated database (sign-in and `/api/auth/me`, the paid
   and free answers of the plan gate, the granted and refused project read,
   a hashed asset and a missing one), and each must equal its answer before
   the migration. A difference means the release needs manual recovery.
4. **Retry.** The ledger-driven re-run must plan nothing. Each pending file is
   replayed once as if its ledger row had been lost: it must refuse and roll
   back (the runner then stops and names it, §4) or change nothing; a file
   that changes rows or schema a second time fails. Then the candidate Worker
   on that database must answer exactly as it does on a clean build of the
   candidate schema, and both ledgers must hold the same files and checksums.
5. A migration the rollback classifier calls `manual`, or any release whose
   step 3 differed, must name its forward fix in the file
   (`-- forward-fix: <path>.sql`, a SQL file in the repository or another
   pending migration), and step 4 runs it.

Durable Object migrations are reported **not rehearsed**, with the reason
(they need workerd with Durable Objects bound), and do not fail the run. The
report (JSON and Markdown in the job's artifact and summary) names the base
SHA, the candidate SHA and every pending file with its checksum, so a
release's evidence can cite the rehearsal of the commit it ships. It
rehearses; it does not gate the deploy.

---

## 4. If a migration fails

`migrate-d1.mjs` aborts loudly and names the offending file. Three cases:

**(a) A genuinely new migration has bad SQL.**
Fix the `.sql` file and re-run. The ledger only records files that applied
successfully, so a failed one is still pending and will be retried. Nothing
to clean up.

**(b) `duplicate column name` / `table already exists` on a historical migration.**
Production carries roughly 124 migrations applied by hand before the ledger
existed, so the runner sees them as pending and replaying them fails. This is
the one legitimate use of:

```bash
npm run d1:baseline      # dispatches the locked production baseline workflow
```

It applies the idempotent pending files for real, *records* the non-idempotent
ones without executing them, and prints exactly which it marked so you can
verify them by hand. Run it **once per environment**. Afterwards, plain runs
apply only genuinely new migrations.

**(c) A multi-statement file failed partway.**
D1 applies a `--file` batch as one implicit transaction and rolls the whole
file back on the first error, so nothing of it landed and it is not in the
ledger (GOTCHAS has the 2026-09-03 worked example, with the seeded local
reproduction showing the source table untouched). Fix the file, prove it
against a local D1 the way GOTCHAS describes, and re-run. The one exception
is a file someone applied by hand statement-by-statement: inspect the live
schema first, then either make the file safely re-runnable or write a
forward fix-up.

**(d) `schema_migrations exists but is not this runner's ledger`.**
The target holds a `schema_migrations` with other columns. A read through the
Cloudflare connection on 2026-09-03 showed production that way —
`(name, applied_at)` and four rows nothing in this repository wrote — yet the
first CI migration step the same morning read the runner's own 200-row ledger
through wrangler against the same binding (GOTCHAS has both reads). Against a
foreign shape the ledger DDL is a silent no-op and the first read fails, so
every mode would die with `no such column: filename` before touching anything.
The runner names the shape and refuses. **Only if a CI `dry-run` reports it**,
adopt it in one run:

```bash
npm run d1:adopt-legacy-ledger   # = --remote --adopt-legacy-ledger --baseline
```

That renames the foreign table to `schema_migrations_legacy` (rows kept),
creates the runner's own ledger, and baselines. A baseline **marks** every
non-idempotent file without executing it, on the assumption its effect is
already present — so follow it with

```bash
npm run d1:verify-marked         # = --remote --verify-marked
```

which checks each marked file's tables and columns against the live schema and
un-marks the ones that are absent. Then `--dry-run` shows exactly what a plain
run will apply. Un-marking a row a baseline wrote without executing is the one
exception to the rule below: it corrects a claim the ledger never earned.

### Two rules with no exceptions

- **Never delete a `schema_migrations` row** to force a re-run. If a migration
  needs to happen again, write a new migration.
- **Never edit a migration the ledger records as applied.** Production already
  ran the old bytes; editing them makes the file and the database disagree
  permanently, and every other environment will apply the new version.

---

## 5. Verifying it actually shipped

Check the release run for live smoke, branch rollout, and schema parity. To repeat the live probe separately:

```bash
npm run verify:live      # = node scripts/check-spa-live.mjs
```

**A `WARN … OAuth connectors no client: …` line is not a failed deploy** (D751
T9, #1921). Each host's `/api/health` lists every catalogue OAuth connector as
`connectors_oauth: { <key>: true | false | null }`, and the smoke names each
`false` (no client) or `null` (the readiness read failed) key in one WARN line
and in the run summary. A connector named there cannot be connected until its
client is set: the fix is the owner's keys, in the Integration keys admin page
or as the env pair (for GitHub, #1008 item 33). The run fails only when the
block is missing or malformed, or when it was dispatched with
`connectors_strict` (`SMOKE_CONNECTORS_STRICT=1`).

**`SKIP_LIVE_SMOKE=1` throws away the only evidence the deploy worked.** It
exists for hosts with no network route to production. If you set it, the deploy
is unverified until you check by other means — say so rather than reporting a
clean deploy.

### 5.1 A 401 from a token you minted is not a broken deploy

When probing an authenticated route, do not assume a `JWT_SECRET` from a dev
workspace mints tokens the deployed worker accepts. The worker validates
against *its own* secret, and the two are not necessarily the same value. Use
a real production session, or prove secret parity first. Skipping this step has
already produced one false "production auth is broken" report.

### 5.2 Which build is live, and its provenance (D8073, #8073)

Each production deploy leaves three things behind:

- **The served version.** `GET /api/public/version` answers
  `{ sha, version_id, built_at, missing }`. Every field comes from the
  bundle's own bindings and nothing is read from D1:
  - `sha` comes from `WORKER_DEPLOY_VERSION`, which the deploy already stamps
    with `GITHUB_SHA`;
  - `version_id` comes from the `[version_metadata]` binding
    `CF_VERSION_METADATA`;
  - `built_at` comes from `WORKER_BUILT_AT`.

  A field the deploy did not stamp is `null`, and `missing` names it.
  `scripts/check-spa-live.mjs` reads the route on every host. With
  `SMOKE_EXPECT_SHA` set, the served `sha` must equal it. Unset, it must be a
  commit sha at all. A host serving another build fails the smoke and names
  both shas.
- **The record.** `scripts/deploy/record-deployment.mjs` writes one row to D1
  `deployments` through `POST /api/internal/deployments` and appends the same
  line to the run summary. The row holds the sha, the run id, the Worker
  version id, the attestation URL, `built_at`, `deployed_at` and `rollback_of`.
  - The route takes `Authorization: Bearer <DEPLOY_RECORD_TOKEN>`, a Worker
    secret whose GitHub copy is held only by the `production` environment.
  - Unset, the route answers 503. With a wrong token it answers 401.
  - A re-run of the same deploy answers the row already there. A re-post
    that disagrees with that row answers 409.
- **The attestation.** `actions/attest-build-provenance` signs `docs/` and the
  Worker bundle. Its URL is what the record's `attestation_url` points at.

**What is live today.** The route, the record, the table and the smoke
assertion ship with #8073. The deploy workflow lines are #8069's: the
attestation step, `WORKER_BUILT_AT`, the `[version_metadata]` binding, the
record step and `SMOKE_EXPECT_SHA`. They are proposed there as a diff, and
until they land:
- `version_id` and `built_at` read `null`;
- the smoke checks only that some sha is served;
- the record is written by hand from a shell that holds the token, for
  example after an operator dispatch:

```bash
DEPLOY_RECORD_TOKEN=... GITHUB_SHA=<sha> GITHUB_RUN_ID=<run id> \
WRANGLER_DEPLOY_LOG=deploy.log ATTESTATION_URL=<url> \
node scripts/deploy/record-deployment.mjs
```

It exits 1, and the summary carries no line, when the record was not
written. The deploy itself is not undone. Rollback mechanics are out of scope
here. `rollback_of` only names the recorded deploy that a rollback undid.

**Rollback of this change.** Reverting the PR removes the route, the smoke
assertion and the script. The `deployments` table stays, unread, because
migrations are forward-only. Unsetting `DEPLOY_RECORD_TOKEN` alone stops new
records: the route answers 503.

---

## 6. Provisioning a branch — `branch-provision.yml`

**This deploys a SECOND Worker, not this one.** `npm run deploy` ships HQ;
this ships a subsidiary. Nothing in sections 1–5 applies to it except the
migration rules, which it runs through the same `scripts/migrate-d1.mjs`.

**It has never run.** Before the first run, someone with account access has to
set four things (`DECISIONS.md` D.11) — until they exist the workflow fails
at the step that needs them, which is deliberate: each failure names the exact
right it is missing rather than a generic error.

| what | why |
| --- | --- |
| A dedicated subsidiary provisioning identity. Hold dispatch until it is wired and scoped as described in the [credential runbook](PRODUCTION_CREDENTIALS.md) | the create steps, and the custom domain for `<code>.axal.vc` |
| `BRANCH_SECRET_BUNDLE` — newline-separated `NAME=VALUE` pairs | `SCORING_HMAC_SECRET`, `KEK_PII`, `KEK_R2`, `AXAL_ENCRYPTION_SECRET`, `TURNSTILE_SECRET_KEY`, the mail credentials. Without it the Worker deploys and answers **503 config_error** on every request — up, and refusing everything |
| `HQ_RPC_SECRET` — one high-entropy value, **set once and never rotated per branch** (D120), in **two places**: as a `production-ops` environment secret, and by hand as a Worker secret on HQ (`wrangler secret put HQ_RPC_SECRET --config wrangler.toml --env production`) | the HQ→branch leg. The run puts only its SHA-256 on the new branch, as `HQ_RPC_SECRET_HASH`. Without it the branch deploys fine and HQ cannot open a support session on it — `authenticateHq` refuses rather than defaulting open, and the workflow warns rather than failing |
| `GITHUB_ACCESS_TOKEN` with `actions: write` (task #192) | only for HQ's Deploy **button** to dispatch this. Running it by hand from the Actions tab needs nothing extra |

**Why `HQ_RPC_SECRET` is generated by a person and not by the run.**
`RPC_SECRET` is minted fresh per provision because it identifies **one branch**.
HQ is one Worker with one identity, so every branch stores the hash of the
**same** secret — and generating it inside the workflow would rotate it on each
provision, silently breaking the HQ→branch leg for every branch provisioned
before. Rotating it deliberately means re-running the workflow for every live
branch, which the registry enumerates.

**And why the run does not put the plaintext on HQ for you.** That would be a
`wrangler secret put --config wrangler.toml`, and no call in this workflow may
read HQ's config — its `[[routes]]` are the apex custom domains, and
`frontend/test/branch_provision_workflow.test.mjs` enforces it. The guard has
been narrowed exactly once, for `d1 execute studioos-db`, because writing
`licence_deployments.rpc_secret_hash` cannot be done any other way. Setting a
Worker secret can: the operator is already creating the value, so they run the
one command above. A convenience is not a reason to widen a rule about the apex
domains.

**Run the first one on a throwaway.** Code `test`, hostname `test.axal.vc`.
It exercises every step against a real account without a licence holder
depending on the result, and the same workflow's delete path retires it.

**What "done" means.** Not "the deploy succeeded". The smoke step is the
definition: `check-spa-live.mjs` against the new host **and** `/api/health`
returning 200. A Worker that deployed and answers 503 has deployed and is not
live, which is exactly the state a missing `BRANCH_SECRET_BUNDLE` produces.

**Afterwards, HQ still cannot call it.** The run opens a PR carrying the
registry entry and HQ's `BRANCH_<CODE>` service binding; HQ gains the binding
on its **next deploy**, not on merge. In between, HQ's Home shows the branch as
`not_deployed` — it holds the registry row and has no way to call it — which is
a different state from `unreadable` and renders differently. That gap is the
accepted cost recorded in the plan's F.11.

**If it fails half way, re-run it.** Every create step tolerates "already
exists", and the principal seed is `INSERT OR IGNORE`. The one thing it
refuses outright is a code whose `infra/branches/<code>.json` is already
committed: that is a branch someone has already provisioned, and the fix is to
use a different code or to retire the existing one first.

**Per-branch setup a workflow cannot do.** Every OAuth provider's redirect URI
for the new host (Google, LinkedIn, HubSpot, Salesforce, DocuSign, Carta,
Slack, Stripe, Calendly, X), a Stripe account, an email sender. The branch's
Integration Keys page names each one as not configured until it is — which it
already does when credentials are unset, so nothing new has to be built for
this to read correctly.

---

## 7. Related, but not this runbook

- **How the apex came to be Worker-served** — `documentation/architecture/CLOUDFLARE-CUTOVER.md`
  is the plan that retired the GitHub Pages apex; its status line predates
  the end of the story. Cloudflare Pages took `axal.vc` on 2026-08-31
  (`e1de44c2f`), and on 2026-09-01 the `studioos` Worker took both `axal.vc`
  and `app.axal.vc` as whole-host custom domains (`1d320dda9`, a commit whose
  message says nothing about routing). Since then `npm run deploy` ships the
  SPA and the API to both hosts together and there is no separate apex step;
  who serves a host is settled by the deploy log's `Deployed studioos
  triggers` lines, never by prose (the Cloudflare Pages mirror that once
  shadowed it was retired on 2026-09-03, `DECISIONS.md` D36).
  `OAUTH_CALLBACK_BASE_URL` stays pinned until every redirect URI is
  registered; flipping it early breaks Google sign-in for everyone at once.
- **A production incident** — `documentation/operations/INCIDENT_RESPONSE.md`.
- **A red `schema-drift` job after a deploy** — `documentation/operations/SCHEMA_DRIFT.md`:
  what is checked before a deploy versus found after it, and how the finding
  is escalated and corrected (#4591).
- **Gotchas that bite during a deploy** — `documentation/architecture/GOTCHAS.md`.

---

## 8. Why nothing here is hardcoded

An earlier version of this procedure named the pending migrations as "184–188"
and told the operator to stop if anything else appeared. Migrations 190 and 191
landed days later. Followed literally, that instruction aborts a correct deploy;
followed loosely, it trains the operator to ignore the stop condition — which is
worse, because the stop condition is the part that matters.

The same applied to a stated count of route patterns in `wrangler.toml`, which
went stale the next time a route was added.

So: no migration numbers, no route counts, no test totals in this file. Every
fact is a command whose output is current by construction. If you extend this
runbook, hold that line.
