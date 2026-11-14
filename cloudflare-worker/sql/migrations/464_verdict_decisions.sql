-- 464 — Verdict's decisions: their scope, their chain, the evidence each rests
-- on and the commitments it creates (D693, #1702).
--
-- Only `services/verdict.ts` reads or writes these three tables
-- (`services/records/owned.ts` may test that an id is the venture's).
--
-- validation_decisions (migration 211), four new columns:
--   hypothesis_id        the hypothesis the decision is For. NULL is the
--                        venture. A decision supersedes only the current given
--                        decision of its own scope, so a decision on H2 never
--                        retires the venture's verdict, and the reverse.
--                        NO `ON DELETE` ACTION, on purpose. `ON DELETE SET NULL`
--                        would turn a decision on one claim into a decision on
--                        the venture. Hypotheses are retired, never deleted
--                        (schema_baseline.sql's `retired_at`), and a project's
--                        delete removes both tables' rows (projects cascade;
--                        services/projectTrash.ts).
--   supersedes_id        the given decision of the same scope this one
--                        superseded, chosen inside the writer's batch
--                        (INSERT … SELECT), or NULL.
--   state                'given' or 'withheld'. A decision resting on fewer
--                        checked pieces of evidence than DECISION_EVIDENCE_BAR
--                        is kept as withheld: never current, superseding
--                        nothing. A row written before 464 reads as 'given'.
--   pivot_hypothesis_id  the hypothesis a Pivot started, or NULL.
--
-- NO UNIQUE INDEX ON THE CURRENT DECISION. The old route superseded and
-- inserted in two statements outside a batch, so a venture may already hold
-- two rows with `superseded_at IS NULL`; such an index would fail this
-- migration on deploy. The reader takes the newest.
--
-- Nothing is backfilled: an old row has no evidence because none was kept, and
-- the record says so instead of inventing any.
--
-- validation_decision_evidence  each piece of evidence a decision rests on, as
-- it read when the decision was recorded, so the record does not change when
-- the evidence is edited later.
--   id, uid              row id; an opaque id (crypto.randomUUID()).
--   decision_id          the decision; it goes with it.
--   kind                 the evidence item's kind, as the evidence reader names
--                        it. Not constrained, so a new kind needs no rebuild.
--   ref_id               the item's key in the evidence reader, which names the
--                        link it came through.
--   label                the item's label, naming its claim.
--   strength             'anecdote', 'pattern' or 'measured'; NULL is not
--                        recorded.
--   direction            'supports' or 'contradicts'.
--   on_date              the item's own date.
--   created_at, updated_at
--
-- validation_decision_commitments  what a decision commits the venture to.
--   id, uid              as above.
--   decision_id          the decision that created it; it goes with it.
--   project_id           the venture; it goes with it.
--   text                 the commitment.
--   owner_user_id        who owns it; NULL once that account is gone.
--   created_by           who added it; NULL once that account is gone.
--   due_date, done_at    when it is due; when it was closed.
--   created_at, updated_at
--
-- Retention: rows are kept for the life of the venture and go with it. A
-- decision is never edited or deleted (D693 decision 4).
--
-- The ALTERs are not re-runnable; the migration ledger stops the replay.
-- No BEGIN/COMMIT.
ALTER TABLE validation_decisions ADD COLUMN hypothesis_id INTEGER REFERENCES hypotheses(id);
ALTER TABLE validation_decisions ADD COLUMN supersedes_id INTEGER REFERENCES validation_decisions(id);
ALTER TABLE validation_decisions ADD COLUMN state TEXT NOT NULL DEFAULT 'given' CHECK (state IN ('given', 'withheld'));
ALTER TABLE validation_decisions ADD COLUMN pivot_hypothesis_id INTEGER REFERENCES hypotheses(id);

CREATE INDEX IF NOT EXISTS idx_validation_decisions_scope
  ON validation_decisions(project_id, hypothesis_id, superseded_at);

CREATE TABLE IF NOT EXISTS validation_decision_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  decision_id INTEGER NOT NULL REFERENCES validation_decisions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  strength TEXT CHECK (strength IN ('anecdote', 'pattern', 'measured')),
  direction TEXT NOT NULL CHECK (direction IN ('supports', 'contradicts')),
  on_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_validation_decision_evidence_decision
  ON validation_decision_evidence(decision_id);

CREATE TABLE IF NOT EXISTS validation_decision_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  decision_id INTEGER NOT NULL REFERENCES validation_decisions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_validation_decision_commitments_decision
  ON validation_decision_commitments(decision_id);
