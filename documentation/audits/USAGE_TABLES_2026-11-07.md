# Usage tables: dependencies, indexes and retention — 2026-11-07 (#4568, D4568)

A snapshot, true on 2026-11-07 on `agent/claude-s15/4568-usage-indexes`, and not
maintained afterwards. The machine-readable matrix is
`USAGE_TABLES_2026-11-07.json`, beside this file. To regenerate it:

```
node scripts/usage-tables-matrix.mjs                  # the matrix
node scripts/usage-tables-matrix.mjs --candidates     # the plan diff with D4568's indexes
npm run bench:d1 -- --tenants 1 --index-control 1000,10000,100000
```

**Class:** simulated. Everything below is read from the code and planned on the
migrated schema. It contains no production observation; production's row
counts and query insights are the owner's (`D1_BENCHMARK.md` §3).

## 1. The matrix, by table

The generator reads every SQL string in `cloudflare-worker/src` that names a
table, and plans it with `EXPLAIN QUERY PLAN`. It found 342 statements; every
one but one is planned. The exception is in `agent_task_runs`, a statement
built at run time.

| Table | Statements | Writes | Reads | Writer files | Reader files | Statements that scan it | Consumers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `ai_usage_logs` | 107 | 5 | 102 | 4 | 55 | 43 → **35** | metering, money, HQ usage, agents, skills, decks, proposals, other |
| `ai_budget_reservations` | 43 | 6 | 37 | 1 (`aiBudget.ts`) | 15 | 2 | money, agents, HQ usage, decks |
| `ai_credit_ledger` | 36 | 6 | 30 | 4 | 8 | 1 | money, HQ usage, decks |
| `agent_task_runs` | 39 | 9 | 30 | 5 | 12 | 6 | agents, erasure |
| `ai_rail_proposals` | 117 | 48 | 69 | 17 | 30 | 13 | proposals, agents, decks |

- **Reading the scan column.** For `ai_usage_logs`, "43 → 35" is today's count, then the count with D4568's indexes. Each file's consumer is assigned by path rules (`CONSUMERS` in `scripts/lib/usageTablesMatrix.mjs`); `other` means no rule matched.
- **`ai_usage_logs` has few writers.** Only four files write to it, chiefly `aiRouter.ts`, through one insert. Almost every cost of this table is on the read side.
- **Most of the remaining 35 scans are HQ aggregates over `created_at` windows.** Examples are `aiRouter`'s admin metrics, `aiSpend`, `aiUsageAdmin` and `adminInsights`. They run when someone opens an HQ page, not on a member's or agent's path. They are left alone here (§5).

## 2. Indexes: read benefit against write cost

These are the indexes on the five tables, with the number of statements whose plan uses each:

| Index | Columns | Used by | Note |
| --- | --- | ---: | --- |
| `idx_ai_usage_user_created` | user_id, created_at | 21 | the member's own history (25 before: four deck reads now prefer the reservation index) |
| `idx_ai_usage_agent_created` | agent_id, created_at | 4 | |
| `idx_ai_usage_task_created` | task, created_at | 4 | |
| `idx_ai_usage_user_page_created` | user_id, rail_page, created_at | **0** | written on every insert. Review: is it read by a shape the planner prefers it for in production? Not dropped. |
| `idx_ai_usage_logs_skill` | skill_id, created_at, partial | **0** | partial, so only skill runs write it. Review, not dropped. |
| **`idx_ai_usage_logs_guard_for`** (new) | guard_for, partial | 5 | `chargedFor`, `tagUsage`, sessions, work runs, deck usage |
| **`idx_ai_usage_logs_reservation_ref`** (new) | reservation_uid, record_ref, partial | 8 | the deck step, batch and generation charge reads, image draw, revenue |
| `idx_ai_reservations_user_state` | user_id, status, expires_at | 11 | |
| `idx_ai_reservations_idempotency` | user_id, idempotency_key, unique partial | 2 | D844's one hold per key |
| `idx_ai_credit_ledger_user` | user_id, created_at, uid | 10 | |
| `idx_agent_task_runs_live` | agent_id, unique partial (live) | 3 | one live run per agent |
| `uq_raise_evidence_proposal_source` | record_ref, source_ref, unique partial | 0 | It enforces uniqueness; it is not there for reads. Keep. |

No index on these tables is a leading-column prefix of another with the same partial clause (`prefix_of` in the JSON).

**Both new indexes are partial.** A row without the column writes nothing to the index: a model row has no `guard_for`, and a call outside a parent hold has no `reservation_uid`. An equality on the column implies the `IS NOT NULL` predicate, so every read above can use them.

## 3. Before and after (simulated)

**The database-only control** (`indexControl`). `ai_usage_logs` is filled with rows shaped like a run's: one model row under a hold, and two guard rows naming it. Each read is the statement's mean over 200 calls. The insert cost is per row in a burst of 3,000, timed inside one transaction, so it measures index upkeep rather than commit time.

| Rows | `chargedFor` without → with | Step charge without → with | Insert, per row, without → with |
| ---: | --- | --- | --- |
| 1,000 | 0.052 → 0.005 ms | 0.044 → 0.004 ms | 0.0044 → 0.0056 ms |
| 10,000 | 0.47 → 0.005 ms | 0.40 → 0.004 ms | 0.0046 → 0.0050 ms |
| 100,000 | 6.4 → 0.005 ms | 5.2 → 0.005 ms | 0.0052 → 0.0059 ms |

- **Plans.** Without the indexes, both reads are `SCAN ai_usage_logs`. With them, `chargedFor` is a `MULTI-INDEX OR` of the rowid and `idx_ai_usage_logs_guard_for`, and the step charge is a `SEARCH` on `(reservation_uid=? AND record_ref=?)`.
- **Write cost.** Upkeep adds about 0.0007 ms per inserted row, roughly 14% on this burst. Read cost no longer grows with the table.

**A full agent run.** This was #4567's mix C: 10 tenants, 200 runs, concurrency 1, every invariant 0.

| | Statements | Scans in the run | p50 | p95 | Bytes per 1k runs |
| --- | ---: | --- | ---: | ---: | ---: |
| Before (indexes dropped) | 86.4 | `chargedFor` + 3 small config tables | 26.2 ms | 35.4 ms | 4.73 MB |
| After | 86.4 | 3 small config tables | 25.9 ms | 33.9 ms | 4.92 MB |

At 600 usage rows the latency barely moves; the control above shows where it does. Storage per run grows about 4% for the two indexes.

**`agentAreas` → `agentArea`.**
- **The change.** The run path asked for every agent's area on the platform (`SCAN agent_skill_links`) to keep one entry. It now reads one agent's links through `UNIQUE (agent_id, skill_id)`: `SEARCH l … (agent_id=?)`.
- **Who uses which.** `runDetail` uses the one-agent read too. The HQ boards that need every agent (the spend radar and the runs list) keep `agentAreas`.

## 4. Foreign keys and triggers that bound any retention change

Into the usage tables:

| From | Column | To | On delete |
| --- | --- | --- | --- |
| `agent_task_runs` | `usage_log_id` | `ai_usage_logs.id` | **NO ACTION**: a usage row a run names cannot be deleted while that run row exists |
| `ai_rail_proposals` | `usage_log_id` | `ai_usage_logs.id` | SET NULL |
| `team_agent_events` | `usage_log_id` | `ai_usage_logs.id` | SET NULL |
| `ai_topup_ledger` | `reservation_uid` | `ai_budget_reservations.uid` | **NO ACTION** |
| `build_plan_items` | `proposal_uid` | `ai_rail_proposals.uid` | **NO ACTION** |
| `raise_claim_evidence`, `raise_evidence_items` | `proposal_uid` | `ai_rail_proposals.uid` | SET NULL |
| `agent_memory_notes` | `run_id` | `agent_task_runs.id` | SET NULL |

Out of them, `ai_budget_reservations.user_id` and `ai_credit_ledger.user_id` are NO ACTION to `users`, while `ai_rail_proposals.user_id` cascades.

**Triggers:**
- `ai_credit_ledger_no_update` and `ai_credit_ledger_no_delete` make the ledger append-only.
- `ai_credit_ledger_reservation_hold` and `_settle` write the ledger from reservation status changes (D755).

**Erasure today.** The platform performs no automated erasure. D168's data-subject request is closed by a person, and the code has no `DELETE FROM users` and no anonymisation (`services/dsrRequests.ts`). `agents/erasure.ts` ends runtime state only and deletes no D1 row.

## 5. Not changed here, and why

- **The HQ `created_at` aggregates (about 30 scans).** The obvious fix is an index on `ai_usage_logs(created_at)`, which would add a write to every insert for reads that run when HQ opens a page. That is worth it only if production's query insights show these statements are hot (`D1_BENCHMARK.md` §3). This is evidence-gated.
- **The two indexes no plan uses** (`idx_ai_usage_user_page_created`, `idx_ai_usage_logs_skill`). Dropping one saves a write per insert. But the planner's choice with real statistics can differ from an empty schema's, and dynamic statements may use them. Check production's insights first.
- **Policy and config reads on every AI call** (#4567 §4.3). These are a caching change in `aiRouter`, not an index; that belongs to a separate PR.
- **Batching a run's writes** (#4567 §4.4). That changes the transaction boundaries of the hold and settle path, which needs its own review.
