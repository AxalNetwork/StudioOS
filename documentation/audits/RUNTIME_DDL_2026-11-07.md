# Runtime DDL against an up-to-date database — 2026-11-07 (#4568 R2-04)

A snapshot, true on 2026-11-07 on `agent/claude-s15/4568-runtime-ddl` (from
`main` at `805f58221b`), and not maintained afterwards. To regenerate the
inventory: `node scripts/check-runtime-ddl.mjs --json`.

**Class:** simulated, from the code and the migrated schema. The production
evidence is the audit's, in #4568's R2-04 comment:
- repeated `duplicate column name` errors;
- one sampled telemetry minute, with its caveats: 3,852 queries at a mean of about 0.334 ms. That is not a peak, a p95 or a capacity figure.

## Findings

| | Count |
| --- | ---: |
| Runtime `ALTER TABLE … ADD COLUMN` in `cloudflare-worker/src` | 403, in 65 files |
| Files that ask the table first (`runSchemaBootstrap` / `tableColumns`) | 5 (4 before this change) |
| Files that ALTER blind: try, and swallow the error | 60 (61 before) |
| Blind ALTERs | 356 (360 before) |
| …of a column a migration already declares | **355** (359 before) |
| …of a column no migration declares | 1: `users.marketing_unsubscribed_at` (`routes/notifications.ts`), for #4591 |

**What a blind ALTER of a declared column does.**
- Against an up-to-date database, such as production, it cannot succeed: it fails with `duplicate column name`, then the code swallows the error.
- Each file's per-binding readiness cache (a `WeakMap` keyed on `env.DB`) stops the repeats within one isolate. It cannot stop them across fresh isolates, and every cold start or cron isolate pays them again.
- With the column already present, that is all overhead and error noise: no schema changes.

**The largest blind files:**

| File | Blind ALTERs |
| --- | ---: |
| `routes/wellbeing.ts` | 42 |
| `services/landingPageSchema.ts` | 39 |
| `services/advisorStoresSchema.ts` | 18 |
| `routes/projects.ts` | 16 |
| `services/discoveryInterviewSchema.ts` | 14 |
| `services/fills/provenance.ts` | 14 |
| `routes/decks.ts` | 13 |

Every one of these columns is declared by a migration.

## What changed

1. **`services/cohortApplications.ts`, the bootstrap the audit named.** It ran on every cron tick. It now goes through `runSchemaBootstrap`, which reads `cohort_cycles`' columns once per binding and issues no ALTER when they are there. Migration 157 declares all four.
   - **Before:** four ALTERs and four `duplicate column name` errors per fresh isolate.
   - **After:** one `pragma_table_info` read, and no ALTER or error.
   - **A genuine failure** (for example, a missing table) now throws `cohort_schema_not_ready`, is not marked ready, and is retried on the next call. Before, it logged and returned, and the caller carried on against tables that might be incomplete. Every caller already handles a throw: the cron tick and the apply route catch and log it, and the admin routes return the app's 500.
2. **`scripts/check-runtime-ddl.mjs`, a ratchet in `test:guards`.** `runtime-ddl-baseline.json` records the 356 blind ALTERs per file:
   - a file may not exceed its entry;
   - a new file may not ALTER blind;
   - a file that improves must lower its entry.
   - New schema goes in a migration. A bootstrap that preview or local databases still need goes through `runSchemaBootstrap`.

## Supported environments

- **Production and preview** run migrations at deploy (`migrate-d1.mjs`). There, the bootstrap is a safety net that should find every column present.
- **Local and branch databases** that have not run a migration still get the four columns and the four tables. That is why the bootstrap stays rather than being deleted.

## Rollback and compatibility

- **No schema change.** An old Worker against the same database behaves as before: blind ALTERs, duplicate-column errors swallowed.
- **Reverting** the service file restores the old bootstrap.

## Next, measured file by file

The remaining 60 files are the same mechanical move: route each file's statements through `runSchemaBootstrap`, then lower its baseline entry. Each move should come with its own handler test proving no ALTER against the migrated schema, as `runtime_ddl_4568.test.ts` does for the cohort bootstrap. Order them by how often their path runs: the cron and per-request middleware first. Production's query insights (`D1_BENCHMARK.md` §3) can rank them by observed `duplicate column` errors.


### #5343 batch 4 — investor role bootstrap

The investor bootstrap runs before role-dependent requests on a cold binding. This
puts it ahead of individual route bootstraps based on the entry point, without
using production traffic data. The checked-in schema baseline already declares
`users.investor_id`. The same safety net adds it for legacy local/branch databases
through `runSchemaBootstrap`. A failed schema check returns
`investor_schema_not_ready` with HTTP 503 for those requests and is retried on the
next request. Anonymous reads that bypassed role bootstrap still bypass it.

The guard baseline drops from 310 to 309 statements, in 41 files instead of 42.

### #5343 batch 5 — ten service bootstraps

Ten service bootstraps whose failure path was already settled move onto
`runSchemaBootstrap`; the guard baseline drops from 304 to 266 statements, in 30
files instead of 40. The files, the two kept back (`referralCommissions.ts`,
`sanctions.ts`) and why are in `documentation/architecture/decisions/D5343-p5.md`.
