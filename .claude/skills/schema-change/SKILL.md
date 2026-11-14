---
name: schema-change
description: Changing the D1 schema (a new table, column, index, view or trigger, or a drop or rename) for StudioOS. Use when an issue needs a new file under cloudflare-worker/sql/migrations/, when Worker code adds runtime DDL, or when a schema guard (check-sql-migrations, check-migration-declarations, check-runtime-ddl, check-schema-pair-drift, check-sqlite-columns and the rest) fails on your branch.
---

# Schema change

D1 (`studioos-db`) is the canonical store (CLAUDE.md, fact 2). Every schema
change reaches it through one path: a new migration file that the deploy
applies before the Worker ships (`scripts/migrate-d1.mjs --remote`, the
"Apply pending D1 migrations" step). This skill writes that file by the
naming rule, keeps the Worker's own DDL in step with it, and runs every guard
that reads the schema before you push.

Read `AGENTS.md` § House rules ("Migrations", "Tests", "Decisions") and
`documentation/operations/SCHEMA_DRIFT.md` §1 and §4 first. They win when
this file disagrees.

## Steps

Run every command from the repository root, on your issue's branch.

1. **Name the file by the current UTC minute and your issue.**
   ```
   node scripts/schema-change.mjs name --issue <issue> --slug <slug>
   ```
   It prints `cloudflare-worker/sql/migrations/YYYYMMDDHHMM_<issue>_<slug>.sql`
   and refuses a slug that is not lower case `a-z0-9_` starting with a letter,
   or an identity a file already holds. By hand, the stamp is
   `date -u +%Y%m%d%H%M`. Take it when you write the file. Never take "the
   next free number": numbered files stop at 799 (`NUMBERED_CEILING` in
   `scripts/lib/migrationPlan.mjs`), and only an issue written before D4106
   that already gave a number may still use one.
2. **Write the SQL.** One change, expand first (rules below). Start the file
   with a `--` comment naming the decision and issue, as
   `202611072301_company_profiles_field_triggers.sql` does.
3. **Keep the Worker in step.** New code reads the new shape through a
   migration, not through runtime DDL. If a file already has a runtime
   bootstrap for the table (`CREATE TABLE IF NOT EXISTS` in a route or
   service), make it declare the same columns as the migration, and route any
   `ADD COLUMN` through `runSchemaBootstrap`
   (`cloudflare-worker/src/util/schemaBootstrap.ts`), never a blind
   `ALTER` in a `try`/`catch` (#4568, D5343).
4. **Preflight.**
   ```
   git fetch origin main
   node scripts/schema-change.mjs preflight --issue <issue>
   ```
   It lists the migrations your branch adds (committed or not) against
   `origin/main` (`--base <ref>` for another base) and fails on: a name the
   guards refuse, a new stamped file without its issue, a stamp before
   `202611110000` (a backdated name), a file sharing a stamp and issue with
   another, a stamp later than now, a stamp naming another issue, a new
   numbered file, an edit, delete or rename of a migration on the base
   (committed or not, D269), `ADD COLUMN … NOT NULL` with no `DEFAULT` (a
   `NOT NULL` inside a `CHECK (…)` does not count), and a transaction
   statement. It notes (`·`)
   what to check by hand: a `CREATE` without `IF NOT EXISTS`, a drop, a
   rename, and runtime `ALTER TABLE … ADD COLUMN` or `CREATE TABLE` your
   branch adds under `cloudflare-worker/src`.
5. **Run the schema guards.**
   ```
   node scripts/schema-change.mjs checks
   ```
   It runs `scripts/build-generated.mjs`, then each guard below in
   `test:guards` order, then `migration-immutability-gate.mjs` with
   `GITHUB_BASE_REF=main`, and prints pass or FAIL per guard with the failing
   output. The gate fetches `origin/main` and diffs `origin/main...HEAD`, so it
   sees committed changes only; preflight (step 4) is what catches an
   uncommitted edit to an applied migration. About 90 seconds; `check-runtime-schema-declared` takes about 40 of
   them. It needs `node_modules`. Each guard also runs alone as
   `node [--no-warnings] scripts/<name>.mjs`, with the flags `package.json`'s
   `test:guards` gives it.
6. **Test the migration on a fresh build.** A worker test that loads the
   migrated schema runs the baseline plus every migration above the cutoff,
   yours included:
   ```js
   import { DatabaseSync } from 'node:sqlite';
   import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
   const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
   loadSchema(db);
   ```
   `cloudflare-worker/test/brand_locks_d1572.test.ts` and
   `deck_media_d1545.test.ts` load the schema this way.
   `cloudflare-worker/test/legal_template_research_schema_4591.test.mjs`
   builds it another way (`buildFresh` and `postCutoffMigrations` from
   `scripts/check-baseline-drift.mjs`, run with a plain `node --test`); read
   it for what to assert: the columns, defaults, unique constraints and
   indexes, not only the names (SCHEMA_DRIFT.md §1). Run one file with
   `node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/<file>`.
   Mutation-check each new assertion both ways (AGENTS.md § Tests).
7. **Record the decision** in `documentation/architecture/decisions/D<issue>.md`
   and run `node scripts/check-decision-ids.mjs`. Then the full suite before
   you push, as AGENTS.md § Tests says.

## The rules it applies

**Naming (D4106, D5398).** From 2026-11-11 00:00 UTC (`DISCRIMINATOR_FROM`)
a migration is `YYYYMMDDHHMM_<issue>_<slug>.sql`: twelve digits, the issue
(1 to 7 digits, no leading zero), a slug starting with a letter. A file's
identity is stamp plus issue (`migrationIdentity`). That is how two PRs in
the same minute are kept apart: two issues never share an identity, so they
cannot collide. Before the issue was required, two pairs did collide, at
`202611072219` and `202611092035`; both merged and stay as they are
(`LEGACY_DUPLICATE_STAMPS`). The same minute and the same issue twice still
fails `check-sql-migrations`, naming both files. Two parts of one issue
written in one minute: wait a minute and re-stamp the file that is not yet on
`main`.

**Stacked PRs carry their base's file.** The advisory overlap bot
(`.github/workflows/pr-overlap.yml`, hourly, comment marker
`<!-- studioos-pr-overlap:v1 -->`) reported "shared new migration stamp:
202611140007" between #5855 and #5822 because #5855 is stacked on #5822 and
carries the same file, `202611140007_5581_work_graph_revisions.sql`. Same
path, same bytes: expected. A different file with your stamp and issue is a
collision: re-stamp yours.

**Applied migrations are immutable (D269).** A file on `main` is never
edited, deleted or renamed. `scripts/migration-immutability-gate.mjs` fails
the PR (workflow "Migration immutability", job "applied migrations
unchanged") and has no bypass. A fix to an applied migration is a new
migration.

**What D1 accepts in a migration.** No `BEGIN`, `COMMIT`, `ROLLBACK`, `END`,
`SAVEPOINT` or `RELEASE` statement, no `PRAGMA` except
`defer_foreign_keys`, no `ATTACH`/`DETACH` (`check-sql-migrations`, D156;
`documentation/architecture/GOTCHAS.md`). A trigger body's `BEGIN … END;` is
allowed. A failed migration stops the deploy before `wrangler deploy`
(`documentation/operations/DEPLOY.md` §4).

**Expand, then contract (SCHEMA_DRIFT.md §4).** Adding a table, a column with
a default, an index or a view ships in one deploy. A drop or rename takes two:
first ship code that no longer uses the old shape, then the migration. A drop
needs the owner's decision, an export and a Time Travel bookmark first.
Rollback reverts the Worker, never D1, so the Worker one version back must
work against your schema. `users` is at D1's 100-column limit (D5343): put a
new per-user field in its own table.

**Runtime DDL (#4568, D5343, D235).** A runtime `CREATE … IF NOT EXISTS` is a
safety net for a declared object, never the only declaration
(`check-runtime-schema-declared`). A runtime `ADD COLUMN` goes through
`runSchemaBootstrap`, which reads the table's columns once per binding and
issues no `ALTER` when the column exists. `check-runtime-ddl` holds
`scripts/runtime-ddl-baseline.json` to the blind `ALTER`s on record: a file
may not grow, and a file that improves lowers its entry
(`--json` prints the inventory). Readiness is cached per `env.DB` in a
`WeakMap`, never a module-level flag (`check-schema-readiness`).

**Timestamps (D124, D125).** SQLite compares timestamps as text, and an ISO
string (`2026-09-16T10:41:47Z`) sorts above `datetime('now')`'s
`2026-09-16 10:56:47` on the same date. Compare `datetime(column)` against
`datetime('now')` or `datetime(?)`, never a bare column, and never
`CURRENT_TIMESTAMP` in a comparison. `check-timestamp-comparisons` watches the
clock columns named in its `TTL_COLUMN` list; a new column compared against
the clock joins that list in the same commit (D135). It cannot see a column
compared bare against a bound parameter: check those yourself.

**Triggers.** A trigger is created only in a migration, as `CREATE TRIGGER IF
NOT EXISTS`, never by hand (AGENTS.md § House rules). An object created from
the dashboard or a hand-run `wrangler d1 execute` is invisible to every guard
and surfaces later as drift (SCHEMA_DRIFT.md §1). Use a trigger with
`RAISE(ABORT, '<table>.<column>: <reason>')` where a `CHECK` would need a
table rebuild, as `202611072301_company_profiles_field_triggers.sql` does.

**Dev parity.** Mirror the change in `backend/app/models/migrations.py` only
if you are iterating on the feature in the Replit dev FastAPI (CLAUDE.md,
"Rules for new work"). It is never deployed.

**Never touch production D1.** Read schema and aggregates only, never write
(AGENTS.md § House rules). Migrations reach production only through the
deploy workflow after merge.

## The guards

| Guard | What it fails on |
|---|---|
| `check-sql-migrations` | a transaction statement, a `PRAGMA` D1 ignores, `ATTACH`/`DETACH`; a name that is neither numbered (≤ 799) nor stamped; a stamped name from 2026-11-11 without its issue; two files sharing a number or identity |
| `check-sqlite-dialect` | Postgres or other non-SQLite SQL in Worker strings (`NOW()`, `::int`) |
| `check-sqlite-tables` | a Worker query naming a table nothing creates |
| `check-sqlite-columns` | an `INSERT`, `UPDATE`, `SELECT` list or qualified reference naming a column nothing creates |
| `check-write-router-columns` | the advisor write router naming a column nothing creates |
| `check-sqlite-table-collisions` | two definitions of one table that each require a `NOT NULL` column the other lacks |
| `check-schema-pair-drift` | a table defined at runtime and in SQL that stops declaring the same columns |
| `check-migration-declarations` | a migration's table or column missing from a freshly provisioned database (baseline plus post-cutoff migrations) |
| `check-runtime-schema-declared` | runtime DDL that creates, or takes away, an object the fresh build lacks (D235) |
| `check-runtime-ddl` | a blind runtime `ADD COLUMN` beyond the baseline, or a stale baseline entry |
| `check-timestamp-comparisons` | a clock column compared bare, or `CURRENT_TIMESTAMP` compared (D124, D125) |
| `check-migration-column-shapes` | a migration naming a column that only some definitions of a multiply-defined table have |
| `check-schema-readiness` | a schema bootstrap remembering "done" in module state instead of per binding |
| `migration-immutability-gate` | an edit, delete or rename of a migration on the base (D269); CI-only workflow, run locally by `checks` |

Most guards carry a baseline JSON in `scripts/` of findings on record. A
baseline only shrinks: fix the SQL or the code, never add an entry to make a
guard pass. `node scripts/migrate-d1.mjs --audit` lists files that are not
safe to replay; it is informational and exits 0.

A full local replay (`npm run d1:migrate:local`, or `node scripts/migrate-d1.mjs
--local --persist-to <dir>` after `--bootstrap`) runs one wrangler call per
file, over 800 files: it did not finish in 9.5 minutes when this skill was
written. Use the test in step 6 instead. For behaviour only D1 shows,
reproduce one file as `documentation/architecture/GOTCHAS.md` describes.

## What this skill does not do

It does not apply a migration to production, preview or a branch database, or
dispatch `d1-migrate.yml`; the deploy applies migrations after merge. It does
not commit, push, open the PR or set labels (`task-lifecycle`). It does not
edit or rename a migration already on `main`, or add baseline entries. It
does not decide a drop; the owner does. `checks` fetches `origin/main`
(through the immutability gate) and otherwise the helper reads git and the
disk; it never calls the GitHub API or writes a file.
