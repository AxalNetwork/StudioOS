# Usage tables: retention tiers and the hot/cold decision

D4568 (#4568, D1 scale S2). This sets out the options for how long
`ai_usage_logs`, `ai_budget_reservations`, `ai_credit_ledger`,
`agent_task_runs` and `ai_rail_proposals` keep their rows, and what must be
true before any of them is moved or deleted.

**Nothing is archived or deleted by this work.** Every tier below that moves
or removes a row is a proposal, gated on the owner's and counsel's decisions
in §4. The dependency facts behind it are in
`documentation/audits/USAGE_TABLES_2026-11-07.md`.

## 1. What each table is for

| Table | What it is | Who relies on it | What must never happen |
| --- | --- | --- | --- |
| `ai_credit_ledger` | the money ledger: purchases, holds, releases, spends, refunds, disputes | statements, refunds and disputes, reconciliation with Stripe | an update or a deletion: its triggers refuse both |
| `ai_budget_reservations` | each hold and its settlement | the atomic balance check, D844's idempotency, reviews | a pending or in-review hold disappearing; a settled hold losing its token |
| `ai_usage_logs` | each model call, its cost and its charge; guard rows name their run | charges (`chargedFor`), HQ usage, skill evaluation, deck step charges | an unrecorded charge read as 0; a charge losing its guard rows |
| `agent_task_runs` | each agent run and its steps | the engine (one live run), the runs board, evaluation | a live run removed; a run losing the usage row it names |
| `ai_rail_proposals` | what a model proposed and what a person decided | the member's queue, the record that was filled, evidence | a proposal kept as evidence (`raise_*`, `build_plan_items`) losing its row |

## 2. Proposed tiers

| Tier | What | Where | Window (proposal) |
| --- | --- | --- | --- |
| **Hot** | everything a request reads: open holds, recent usage, live and recent runs, undecided proposals | D1, the canonical rows | the last 13 months of usage, runs and decided proposals; open items always |
| **Financial record** | the ledger, every reservation, and the usage rows that carry a charge | D1, unchanged | as long as the law and the owner require: **counsel's decision** |
| **Cold artifacts** | decided proposals' payloads and runs' step logs beyond the hot window, as immutable exports | R2, versioned, with object lock if the plan supports it | from 13 months, **only after §4 is met** |
| **Metrics** | counts and sums by day, model and surface | Analytics Engine | as Analytics Engine keeps it |

**Analytics Engine is not a ledger.** It is sampled and has no transactions, so it never answers a balance or a charge. It may answer "how many calls a day", which HQ's charts aggregate today.

**A derived summary never authorizes spend.** The hold remains the atomic check over the canonical counters (`reserveAiBudget`).

**If a rollup is added** (for example, daily usage per user):
- it is rebuilt deterministically from the canonical rows, corrections and refunds included;
- it carries the time it was built, so its staleness is visible;
- it keeps null and zero apart: a day with an unrecorded charge is unknown, never 0.

## 3. What blocks a move today

These facts come from the schema, in the audit's §4:
- **Run → usage.** `agent_task_runs.usage_log_id` is NO ACTION. A usage row cannot be removed while the run that names it exists, so runs and their usage would have to move together.
- **Top-up → reservation.** `ai_topup_ledger.reservation_uid` is NO ACTION, so a reservation it names cannot be removed.
- **Build plan → proposal.** `build_plan_items.proposal_uid` is NO ACTION, so a proposal a build plan keeps cannot be removed.
- **The ledger.** `ai_credit_ledger` refuses deletion. A person with ledger rows is never deleted; #4566's fixtures keep them for the same reason.
- **Erasure.** It is manual (D168). No code anonymises a person today, so a cold tier must not become the first place a person's data outlives a fulfilled request.

## 4. Gates before any row moves or is deleted

Each needs its owner's recorded decision on #4568:

1. **Counsel.** How long financial records and AI usage must be kept, by jurisdiction and by plan. This includes:
   - whether usage rows are financial records;
   - whether a decided proposal's payload is personal data.
2. **Owner.** The hot window, and the cost ceiling of R2 and of the export job.
3. **Recovery.** A restore of an archived month back into a throwaway D1 must reproduce:
   - every charge, balance and statement for that month, exactly;
   - the reconciliation, tested.
4. **Export and reporting.** A member's export and HQ's reports for an archived period must read the cold tier, or say plainly that the period is archived. Never 0.
5. **Data-subject requests.** An erasure must reach the cold tier, or the tier must hold nothing personal.
6. **Immutability.** R2 object lock or versioning must be verified on the account's plan before any claim of immutability is made.
7. **Rollback.** Every migration is additive first (dual-read), and the old path stays until the new one is proved.

## 5. Today's change (D4568)

- **Two partial indexes and a one-agent read.** These are additive and measured (the audit's §3). They move and delete no rows.
- **Rollback.** `DROP INDEX idx_ai_usage_logs_guard_for` or `idx_ai_usage_logs_reservation_ref`, and revert `agentArea`. Nothing reads an index by name.
- **Deploy.** The migration applies at the next deploy after merge. Building each index reads `ai_usage_logs` once, so check its size in production before merging (`D1_BENCHMARK.md` §3, the rowid bound).
