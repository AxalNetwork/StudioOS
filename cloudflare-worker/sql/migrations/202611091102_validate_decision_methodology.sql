-- 202611091102 — D4586 part 2 (#4586): the methodology a Validate decision was recorded under, and the
-- checked links that did not count toward its evidence bar. Named by its UTC minute (D4106).
--
-- WHY. Methodology v2 (D4586 § 4) counts distinct underlying sources, only the decision's own
-- hypothesis's evidence, and only experiments with an observed result. Every link the founder checked
-- stays in the decision's record, with the reason it did not count, and the record keeps the coverage
-- it was decided on (links, sources, interviews, interviewees, organizations).
--
-- TWO NEW TABLES, NO ALTER. `validation_decision_evidence` keeps holding exactly the pieces that count
-- toward the bar, as it has since migration 464, so every reader of `evidence_count` keeps one meaning
-- for v1 and v2 decisions alike. The links that did not count go to `validation_decision_exclusions`.
--
-- HISTORY KEEPS ITS MEANING (D4586 § 6). A decision with no `validation_decision_method` row was
-- recorded under v1, before this migration, and reads as v1: no backfill, nothing recomputed. Neither
-- table is ever updated; a decision is never edited (D693 decision 4).
--
-- Interviewee and organization breadth are stored as counts only (NULL: not recorded on every counted
-- interview). No name is stored here.
CREATE TABLE IF NOT EXISTS validation_decision_method (
  decision_id INTEGER PRIMARY KEY REFERENCES validation_decisions(id) ON DELETE CASCADE,
  methodology_version INTEGER NOT NULL CHECK (methodology_version >= 2),
  links INTEGER NOT NULL CHECK (links >= 0),
  sources INTEGER NOT NULL CHECK (sources >= 0),
  counted INTEGER NOT NULL CHECK (counted >= 0),
  counted_supporting INTEGER NOT NULL CHECK (counted_supporting >= 0),
  counted_contradicting INTEGER NOT NULL CHECK (counted_contradicting >= 0),
  interviews INTEGER NOT NULL CHECK (interviews >= 0),
  interviewees INTEGER CHECK (interviewees IS NULL OR interviewees >= 0),
  organizations INTEGER CHECK (organizations IS NULL OR organizations >= 0),
  bar INTEGER NOT NULL CHECK (bar >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_decision_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  decision_id INTEGER NOT NULL REFERENCES validation_decisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  label TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('supports', 'contradicts')),
  reason TEXT NOT NULL CHECK (reason IN ('duplicate_source', 'other_hypothesis', 'no_observed_result')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_validation_decision_exclusions_decision
  ON validation_decision_exclusions(decision_id);
