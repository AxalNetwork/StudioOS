-- D158 — the guardrail category is computed on every guarded turn and stored.
--
-- `classifyInput` (services/advisor/guardrails.ts) runs Llama-Guard and parses
-- its reply into `{ blocked, score, category }`, where `category` is the S-code
-- naming WHICH RULE FIRED — `s1`, `s10`, and so on — or one of the four
-- non-verdict states `empty` / `safe` / `router_failed` / `error`.
--
-- Measured before this migration was written:
--
--   · the category reached exactly two places, both 422 response bodies
--     (routes/advisor.ts:891 and :1895), and nothing else;
--   · `TurnAudit` carried no field for it;
--   · `advisor_turn_audit` had no column for it, in EITHER of its two
--     definitions — migration 043 and the runtime bootstrap;
--   · `guardrail_category` and `refusal_category` appeared in zero migrations.
--
-- So which rule fired was unrecoverable the moment the response was sent. HQ's
-- Security page could count THAT a guardrail blocked a turn (D152 shipped those
-- counters) and could never say WHAT FOR — on the one screen whose subject is
-- AI safety. Eleventh producer-with-no-store in this programme.
--
-- WHY THE RUNTIME BOOTSTRAP MOVES IN THE SAME COMMIT, which is the trap here.
-- `advisor_turn_audit` has two definitions: this migration's lineage (043) and
-- `ensureAuditSchema`'s `CREATE TABLE IF NOT EXISTS`. A CREATE-IF-NOT-EXISTS
-- does NOT add a column to a table that already exists, so a migration alone
-- would leave the bootstrap's DDL stale and the resulting shape would depend on
-- which ran first — the `metrics_snapshots` collision (#183, #202) that cost two
-- PRs to unwind. `ensureAuditSchema` therefore gains the column in its CREATE
-- *and* a PRAGMA-guarded ADD COLUMN for databases that already carry the table,
-- copying `ensureGuardrailColumns` in that same file rather than inventing an
-- idiom. A test asserts the two definitions agree.
--
-- NOTHING IS BACKFILLED, DELIBERATELY. Production holds 121 rows, 8 of them
-- carrying a refusal_reason, and none of them recorded a category because none
-- was stored. Those rows must read UNKNOWN, never `safe`: a null rendered as a
-- verdict would be a claim about turns that nothing measured, which is the
-- defect class this programme keeps deleting.
--
-- Additive, so no table rebuild. No `BEGIN`/`COMMIT` — D1's HTTP API rejects
-- them and migration 200's deploy failed on exactly that (#26).

ALTER TABLE advisor_turn_audit ADD COLUMN guardrail_category TEXT;

-- The rollup reads "how many turns per category, in the last N days", so the
-- category leads and the timestamp follows — the same shape as this table's two
-- existing indexes (`..._user`, `..._flagged`), both of which lead with their
-- filter column and order by `created_at DESC`.
CREATE INDEX IF NOT EXISTS idx_advisor_turn_audit_category
  ON advisor_turn_audit(guardrail_category, created_at DESC);
