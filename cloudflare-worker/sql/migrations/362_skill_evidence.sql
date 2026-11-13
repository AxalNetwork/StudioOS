-- 362_skill_evidence.sql — skill evidence from platform tools (D318,
-- Profiling v2 Session 9).
--
-- Skills used to come only from what a person SAID (the fit bank's
-- skill_axis answers and the Skills page, both landing in user_skills). This
-- stores what they DID: per (user, radar axis, source) a count of their own
-- recorded actions — decks saved, discovery interviews logged, DD sections
-- signed off, office-hour sessions completed and so on — with the dates of
-- the first and last one and a window-weighted count.
--
-- The map of which action is evidence for which axis is code, not data:
-- services/skillEvidence.ts, EVIDENCE_SOURCES. `source` is that list's key.
--
-- WHAT IS STORED: counts and dates only. Never a title, a note, a document
-- body or anything else a person wrote.
--
-- `weighted` is the count after ageing: an action in the last 12 months
-- counts 1, an older one fades with a 12-month half-life (D318). It is a
-- function of `computed_at`, so a row is rewritten only when a recompute at a
-- later date changes it.
--
-- `skill_evidence_cursor` is the batch recompute's resume point (one row), so
-- the nightly job S14 wires can walk every user in bounded runs and pick up
-- where the last run stopped.
--
-- STANDS ALONE: users is an existing table. CREATE … IF NOT EXISTS only, no
-- BEGIN/COMMIT. Apply with the ledger-driven runner:
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS skill_evidence (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  axis TEXT NOT NULL CHECK (axis IN (
    'product', 'engineering', 'design', 'gtm_sales', 'marketing_brand',
    'finance_ops', 'legal_compliance', 'capital_network'
  )),
  source TEXT NOT NULL,
  count_lifetime INTEGER NOT NULL CHECK (count_lifetime > 0),
  count_window INTEGER NOT NULL CHECK (count_window >= 0 AND count_window <= count_lifetime),
  weighted REAL NOT NULL CHECK (weighted >= 0),
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, axis, source)
);

CREATE INDEX IF NOT EXISTS idx_skill_evidence_axis
  ON skill_evidence (axis, user_id);

CREATE TABLE IF NOT EXISTS skill_evidence_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_user_id INTEGER NOT NULL DEFAULT 0,
  pass_started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
