-- D4208 (#4208, part of #3661 P1): a dismissed preflight warning, kept per
-- deck version so it survives a reload and every editor of the deck sees it.
--
-- One row is one dismissed finding on one version. `finding_id` is the
-- preflight model's "<check>:<card>:<block>:<n>" id (at most 120 characters);
-- the finding's words are never stored. A blocking finding is never written
-- here: `routes/deck_preflight.ts` refuses it with 422. A new version has its
-- own rows, so it starts clean.
--
-- Additive only: one new table, no existing table changes.
CREATE TABLE IF NOT EXISTS deck_preflight_dismissals (
  deck_id      INTEGER NOT NULL,
  version      INTEGER NOT NULL,
  finding_id   TEXT    NOT NULL,
  dismissed_by INTEGER NOT NULL,
  dismissed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (deck_id, version, finding_id)
);
