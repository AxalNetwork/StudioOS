# Deploying to production

The production API and the SPA are one Cloudflare Worker (`studioos`, serving
`axal.vc`). This is the runbook for shipping it. `documentation/architecture/PRODUCTION.md`
describes *what* production is; this file describes *how to change it*.

**Audience:** whoever is at the keyboard — a person, a Replit session, or a
CI job. Every number in this document is produced by a command you run, not
written down here. That is deliberate; see [§7](#7-why-nothing-here-is-hardcoded).

---

## 1. The one command

From the **repository root**:

```bash
npm run deploy
```

npm expands that into three scripts, in order:

| Hook         | Command                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| `predeploy`  | `node scripts/migrate-d1.mjs --remote`                                                        |
| `deploy`     | `npm run build && cd cloudflare-worker && npx wrangler deploy --config ../wrangler.toml --env production` |
| `postdeploy` | `node scripts/check-spa-live.mjs`                                                             |

So one invocation applies pending D1 migrations, builds the frontend into
`docs/`, uploads the worker, and then probes the live site.

A failing `post`-script propagates to the parent `npm run`. **`npm run deploy`
exiting 0 is therefore real evidence that the live smoke check passed** — not
just that the upload succeeded.

### 1.1 Two ways to silently skip the migrations

Both of these deploy the worker *without* applying schema changes, leaving the
new code running against the old database:

1. **`npx wrangler deploy --config ../wrangler.toml --env production` by hand.**
   npm only fires `pre`/`post` hooks for `npm run <script>`. Invoking wrangler
   directly bypasses `predeploy` entirely.
2. **`cd cloudflare-worker && npm run deploy`.** That package's own script is
   `wrangler deploy --config ../wrangler.toml` — no `--env production`, no
   migration hook. Both the top-level `name` and the `[env.production]` `name`
   in `wrangler.toml` are `studioos`, so this *still hits the live worker*; it
   just ships it with the top-level binding, var and route set, ahead of its
   schema.

Deploy from the repository root, through `npm run deploy`. Nothing else.

### 1.2 The same runner, from CI

Two workflows call `scripts/migrate-d1.mjs --remote` with the repository's
Cloudflare secrets, so applying migrations no longer depends on whose
workstation holds wrangler credentials:

| Workflow | When | What it runs |
| --- | --- | --- |
| `cloudflare-worker-deploy.yml` | every push to `main` | the runner, **before** `wrangler deploy` — a failure fails the deploy |
| `d1-migrate.yml` | by hand, from the Actions tab | one of `dry-run`, `adopt-and-baseline`, `verify-marked`, `apply`, each bracketed by a read-only plan |

The token behind `CLOUDFLARE_API_TOKEN` therefore needs **D1:Edit** as well as
Workers Scripts:Edit. Until 2026-09-03 the deploy workflow called
`wrangler deploy` directly — the first "silent skip" above, on every merge.

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
- **`adopt-and-baseline` is production-only.** A branch has no legacy ledger
  to adopt; the workflow fails the run rather than doing something plausible.

Backups follow the same split: `backup-d1.yml` takes a `target_db` and now
writes to `d1/<database>/backup-<date>.sql`, so a branch backup cannot
overwrite production's restore point. `scripts/dr-drill.sh` reads both that
shape and the flat `d1/backup-<date>.sql` used before 2026-09-15, because
object lock keeps those for 365 days and they are the restore points for most
of that year.

---

## 2. Pre-flight

Run these before deploying. Read **exit codes**, not output — several of these
print warnings on success, and a grep for "error" or "fail" will lie to you in
both directions.

```bash
# The full suite. Redirect, then read the code — never pipe this through grep.
npm run test:drift > /tmp/drift.log 2>&1; echo "test:drift exit=$?"

# The committed bundle matches the committed source.
node scripts/check-docs-fresh.mjs --strict; echo "docs-fresh exit=$?"

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

### 2.1 `check-docs-fresh` must be green *before* you deploy

`npm run deploy` runs `npm run build` first, so the bundle that ships is one
built at deploy time — not the `docs/` bytes committed and reviewed in the PR.
If those two differ, you ship something nobody reviewed. `check-docs-fresh
--strict` is what catches the difference, and it is only meaningful *before*
the deploy rebuilds over it.

### 2.2 New bindings go in both tables

`wrangler.toml` declares every binding twice — once at the top level and once
under `[env.production]`. A binding added to only one table is missing in
whichever environment you didn't edit. `scripts/check-wrangler-binding-parity.mjs`
enforces this and runs inside `npm run test:guards`, so a green `test:drift`
already covers it.

---

## 3. Capture a rollback point first

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
npm run d1:baseline      # = node scripts/migrate-d1.mjs --remote --baseline
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

`npm run deploy` exiting 0 already includes the live smoke check. If you need
to re-run it alone:

```bash
npm run verify:live      # = node scripts/check-spa-live.mjs
```

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

---

## 6. Provisioning a branch — `branch-provision.yml`

**This deploys a SECOND Worker, not this one.** `npm run deploy` ships HQ;
this ships a subsidiary. Nothing in sections 1–5 applies to it except the
migration rules, which it runs through the same `scripts/migrate-d1.mjs`.

**It has never run.** Before the first run, someone with account access has to
set three things (`DECISIONS.md` D.11) — until they exist the workflow fails
at the step that needs them, which is deliberate: each failure names the exact
right it is missing rather than a generic error.

| what | why |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` widened to **Workers KV:Edit, R2:Edit, Queues:Edit, Vectorize:Edit, Zone DNS:Edit** (it has Workers Scripts and D1 today) | the create steps, and the custom domain for `<code>.axal.vc` |
| `BRANCH_SECRET_BUNDLE` — newline-separated `NAME=VALUE` pairs | `SCORING_HMAC_SECRET`, `KEK_PII`, `KEK_R2`, `AXAL_ENCRYPTION_SECRET`, `TURNSTILE_SECRET_KEY`, the mail credentials. Without it the Worker deploys and answers **503 config_error** on every request — up, and refusing everything |
| `GITHUB_ACCESS_TOKEN` with `actions: write` (task #192) | only for HQ's Deploy **button** to dispatch this. Running it by hand from the Actions tab needs nothing extra |

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
