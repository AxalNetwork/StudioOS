-- 645 — the founder's note on a claim, and when each deck version was checked
-- (D900, #2679, part 6 of #2434). Number taken by S26 on 2026-10-27 as the next
-- free after 644 on main; to be confirmed on #2679.
--
-- "Keep mine, with a note" (PD13; NAR7 on the narrative, #2696) keeps the
-- stated figure and records why. The note sits on the claim's own row, so the
-- claim check (D1264's upsert, which names only its own columns) never clears
-- it. `note_value` is the stated value the note was written against: once the
-- founder states another figure the note no longer applies, and the read says
-- so rather than carrying it to a figure it was not about. Neither figure is
-- presumed right: the state stays Mismatch.
--
-- `deck_checks` records that a deck version was checked, so a version whose
-- slides state no figure reads "Checked · no figures" and a version never
-- checked reads "Not checked", never zeros. One row per deck version
-- (`pitch_decks` keeps one row per version).
--
-- Grep first (D689 D-t): raise_claims is created by 628 and no later migration
-- alters it; schema_baseline.sql does not hold it.

ALTER TABLE raise_claims ADD COLUMN note TEXT;
ALTER TABLE raise_claims ADD COLUMN note_value TEXT;
ALTER TABLE raise_claims ADD COLUMN noted_at TEXT;
ALTER TABLE raise_claims ADD COLUMN noted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS deck_checks (
  deck_id INTEGER PRIMARY KEY REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  surface_version TEXT NOT NULL,
  figures INTEGER NOT NULL DEFAULT 0,
  checked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_deck_checks_project ON deck_checks(project_id, deck_id);
