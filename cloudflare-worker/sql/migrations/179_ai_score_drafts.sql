-- 179 — The async AI scorer gets its own table instead of the canonical one.
--
-- `queueWorker`'s `ai_scoring` job wrote into `score_snapshots` under five
-- column names that do not exist (market_score, team_score, product_score,
-- capital_score, ai_rationale), inside `.catch(() => {})`. So it has never
-- written a row, and the obvious repair — rename to market_total, team_total,
-- product_total, capital_total, ai_notes — is the wrong one.
--
-- The two scorers are not the same instrument:
--
--                        routes/scoring.ts          ai-workers/scoring.ts
--   dimensions           6 (adds fit, distribution) 4
--   sub-scores           yes, 3 per dimension       none, category totals only
--   scale                0-100                      0-75 (25+20+15+15)
--   anomaly detection    detectAnomalies, and its   none
--                        comment warns that running
--                        it after the INSERT
--                        silently swallows flags
--   integrity            integrity_version, hash    none
--   provenance           is_sandbox, official_week, none
--                        scored_by, inputs_json
--
-- `score_snapshots.tier` is NOT NULL and its thresholds are 85 / 70, which a
-- 0-75 total can never reach; every row from the async scorer would be
-- 'rejected' by arithmetic rather than by judgement. Seventeen consumers read
-- that table — deal memos, the Spin-Out Lab deck, portfolio, watchlist, the
-- public pages — so letting a cruder, unaudited scorer write into it would
-- corrupt the exact dataset the integrity machinery exists to protect.
--
-- Hence a separate table. It deliberately has NO `tier` column: a tier is a
-- decision, and this scorer is not equipped to make one. Nothing reads this
-- table yet, and that is the point — it is queryable evidence of what the
-- async scorer produced, not an input to anything that decides.

CREATE TABLE IF NOT EXISTS ai_score_drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Scales are the scorer's own, recorded as produced. Named for the range
  -- so nobody reads them as the 0-100 canonical dimensions.
  market_0_25   INTEGER NOT NULL,
  team_0_20     INTEGER NOT NULL,
  product_0_15  INTEGER NOT NULL,
  capital_0_15  INTEGER NOT NULL,
  total_0_75    INTEGER NOT NULL,
  rationale     TEXT,
  -- Which model produced it. The scorer falls back to fixed defaults when
  -- env.AI is unavailable, and a draft built from defaults is not a judgement
  -- about the project — this column is how you tell the two apart.
  model         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_score_drafts_project
  ON ai_score_drafts(project_id, created_at DESC);
