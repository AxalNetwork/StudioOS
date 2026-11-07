# D1 benchmark: run it locally, take the production baseline, run it on preview

D4567 (#4567, D1 scale S1; parent #4554). This runbook says how to measure
whether the single D1 database `studioos-db` limits StudioOS under mixed
agent and financial load, without touching production:

| Measurement | Where it runs | Who runs it |
| --- | --- | --- |
| the local benchmark | your machine | anyone |
| the production baseline | production, read-only | the owner |
| the hosted stress run | an isolated preview | the owner |

The findings of 2026-11-06 are in
`documentation/audits/D1_BASELINE_2026-11-06.md`.

**Nothing here changes production.** No step creates a resource, deploys,
writes a row, changes the schema or switches the agent engine on. The
production baseline is read-only and bounded. The hosted run needs #4566's
`isolated` preflight first (`AGENT_EXECUTION_VALIDATION.md`).

## 1. The local benchmark (anyone, any time)

```
npm run bench:d1 -- --tenants 1,10,100,1000 --ops 400 --concurrency 8 --out bench.json
npm run bench:d1 -- --tenants 100 --ramp 1,5,10,25,50,100 --seconds 5 --max-p95-ms 2000 --max-error-rate 0.01
npm run bench:d1 -- --tenants 100 --hot 0.5                       # one tenant takes half the load
npm run bench:d1 -- --tenants 10 --mix C=1 --concurrency 1        # agent runs alone: exact statements per stage
npm run bench:d1 -- --tenants 1 --control 1000,10000,100000       # the chargedFor scan as ai_usage_logs grows
```

**What it does.** It drives the Worker's own services over a throwaway node:sqlite database:
- the database is built from every migration, with foreign keys on;
- it is seeded with #4566's synthetic fixtures, with every row marked `syn-` and every address `@synthetic.invalid`;
- inference is a stub.

There is no network, queue, Workflow or hosted database. The harness is `cloudflare-worker/test/_d1_bench.ts`, and the CLI is `scripts/d1-benchmark.mjs`.

**The mixes:**
- **A** user reads;
- **B** an AI call (hold → settle → usage);
- **C** an agent run end to end;
- **D** proposal reads;
- **E** failures and retries.

Set them with `--mix A=30,B=25,C=20,D=15,E=10` (that is the default).

**Ceilings.** These are refused, never trimmed: 1,000 tenants, 20,000 operations, 600 seconds, and 1,000 starts a second. `--control` takes at most 1,000,000 rows.

**Ramp stops.** The ramp stops at the first step over `--max-error-rate` or `--max-p95-ms`, or at `--max-ops`.

**What it reports.** It writes aggregates only:
- per mix: statements, reads, writes, batches and stages per operation, refusals by code, and p50/p95/p99;
- per fingerprint: count, time, rows changed, query-plan scans, and the written table's index and trigger counts;
- fairness across tenants;
- bytes and rows added per 1,000 executions;
- every invariant.

A fingerprint masks every literal. No bind value, prompt or row is written.

**It exits 1 when an invariant is not 0.** The invariants are:
- double settlement, a missing charge, an orphaned hold;
- a negative balance, including a CHECK refusal;
- a second live run, an orphaned run;
- a duplicate proposal or hold;
- a cross-tenant read;
- unknown read as zero.

**CI** runs only `cloudflare-worker/test/d1_benchmark_4567.test.ts`: a 60-operation mix, each invariant broken on purpose, the control at 500 rows, and a 30-operation CLI run.

**What a local result may claim.**
- Exact: statement counts, stages, plans and index counts.
- Relative only: latency and throughput. They belong to one Node process on one file, and they are never a D1 figure.
- The report says `class: "simulated"`.

## 2. Reading a result

| Field | Means |
| --- | --- |
| `by_mix.X.stmts_per_op` | statements one operation issues: on D1, about that many round trips, less the batched ones |
| `sql_time_share` | the share of wall time spent inside SQL; near 1, the database is the limit |
| `scans` | fingerprints whose plan scans a table; a scan of a growing table is a contention candidate |
| `index_writes_upper` | rows changed × indexes on the table: an upper bound on index writes |
| `fairness` | per-tenant operations and p95: one tenant's load on the others |
| `bytes_per_1k_executions` | local page growth: a lower bound for production, whose payloads are larger |

D1 runs queries one at a time per database. With the owner's measured
per-statement time `t` (§3), the database's own ceiling is about
1 / (statements per operation × `t`) operations a second, before any other
traffic.

## 3. The production baseline (the owner, read-only)

These need the **Account Analytics Read** permission. They are not run by any
PR or CI job. Keep only aggregates: counts, durations and fingerprints, never
bind values. D1 does not capture bound parameters in query insights.

1. **Volume and latency, 7–31 days.** Metrics are kept for 31 days. Use GraphQL `d1AnalyticsAdaptiveGroups` with `accountTag`, `databaseId` and `date_geq`/`date_leq`, grouped by `date`:
   - `sum { readQueries writeQueries rowsRead rowsWritten }`;
   - `quantiles { queryBatchTimeMsP50 queryBatchTimeMsP90 … }`.
   A day with no row is *unavailable*, not zero.
2. **Storage trend.** `d1StorageAdaptiveGroups`, `databaseSizeBytes` by date.
3. **Slow and frequent fingerprints.**
   - `npx wrangler d1 insights studioos-db --sort-by=reads --time-period=7d --json`
   - then the same with `--sort-by=time` and `--sort-by=count`;
   - or the SQL API's `events.d1Queries`, which is sampled. Use `quantileWeighted(0.95, queryDurationMs, sampleInterval)` for p95.
   - Look for the report's §4 fingerprints, especially `… FROM ai_usage_logs WHERE id = ? OR guard_for = ?`.
4. **Table sizes, bounded.** These read one index entry each; never run `COUNT(*)` over a hot table at peak:
   ```
   npx wrangler d1 execute studioos-db --remote --command "SELECT MAX(id) AS n FROM ai_usage_logs"
   npx wrangler d1 execute studioos-db --remote --command "SELECT MAX(rowid) AS n FROM agent_skill_links"
   ```
   A rowid bound overstates the live count when rows have been deleted. Say so with the figure.
5. **Plan and replicas.** Record the account's plan, whether read replication is on, and the migration state (`wrangler d1 migrations list studioos-db --remote`).

Write the result as an audit beside `D1_BASELINE_2026-11-06.md`, labelled **production observation**, with its dates, sampling and what was unavailable.

## 4. The hosted stress run (the owner, preview only)

**Prerequisites** (all of them):
- #4566's preflight reads `isolated` against an observation under a day old.
- The preview D1 is a throwaway database with the migrations applied.
- The owner has approved, on #4567, a **cost ceiling**, a **duration**, a **maximum rate** and a **stop condition** (error rate or p95).

**Seed** with #4566's fixtures, which refuse without the preflight:
```
node scripts/agent-validation-fixtures.mjs seed --run a0bench1 --tenants 10 --agents 3 --tasks 5 --preflight preflight.json --out seed.sql
npx wrangler d1 execute studioos-db-preview --env preview --remote --file seed.sql
```

**Drive** the same mixes from inside the preview Worker, with the inference stub and the fake queue. That driver is not built yet: it belongs to #4594 (hosted lifecycle and capacity).
- `wrangler d1 execute` per statement measures HTTP, not D1, so it is not a substitute.
- Record D1's own `meta.duration`, `meta.rows_read` and `meta.rows_written` per statement, which the local run cannot give.
- Ramp in steps (1, 5, 10, 25, 50, 100…) and stop at the approved limit.

**Record:**
- the preview Worker's version id and its git commit, beside `main`'s;
- the dates, the region and the database size before and after;
- the mix, the concurrency, the throughput completed, the error, 429 and 5xx rates, and p50/p95/p99;
- rows read and written, and the cost;
- the invariants, run as SQL against the preview database;
- the class: **preview platform**.

**Tear down.** Delete the throwaway database, or run `cleanup.sql` and check that `residual.sql` reads zero (`AGENT_EXECUTION_VALIDATION.md` §6).

## 5. Rollback

Nothing to roll back. This adds a test harness, a CLI, a CI test and documents. It changes no schema, binding, route, flag or production setting. Any index or query change the findings suggest is #4568's, with its own before-and-after evidence.

## Related

- `documentation/audits/D1_BASELINE_2026-11-06.md`: the findings and their confidence.
- `AGENT_EXECUTION_VALIDATION.md`: preview isolation, synthetic fixtures and teardown (D4566).
- `documentation/architecture/decisions/D4567.md`: the decision.
