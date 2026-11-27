-- 744 — D1583 (#3830, deck builder v2 F4): a teaser, a one-pager and a memo
-- derived from one frozen deck version. Number given on #3830 by S1.
--
--   pitch_decks.format   what a version row is. Always 'deck': a derived
--                        output is never a version (the owner's answer on
--                        #3830, 2026-11-01). It lives in deck_derivatives,
--                        so no reader that takes "the latest version" of a
--                        venture can pick a teaser, and version numbers do not
--                        skip.
--   deck_derivatives     one accepted teaser, one-pager or memo, pointing at
--                        the frozen master version it was derived from, like
--                        D1565's deck_variants. It is written only when the
--                        founder accepts its proposal (`proposal_uid`, the
--                        ai_rail_proposals row), never by a run.
--
-- What a row holds is already redacted: no figure binding (so no provenance
-- badge or source chip can be drawn from it), no speaker notes on a teaser,
-- and on a blind row no venture or founder name, no logo or photo, and no
-- link, video or audio (so no NDA or data room). A later share or print path
-- reads it as it is.
--
-- Additive: ADD COLUMN with a constant default and CREATE TABLE IF NOT
-- EXISTS. NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): the ledger
-- runner applies it once.

ALTER TABLE pitch_decks ADD COLUMN format TEXT NOT NULL DEFAULT 'deck' CHECK (format = 'deck');

CREATE TABLE IF NOT EXISTS deck_derivatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- The frozen master: one `pitch_decks` row, which is one version.
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('teaser', 'one_pager', 'memo')),
  blind INTEGER NOT NULL DEFAULT 0 CHECK (blind IN (0, 1)),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  -- The cards of a teaser or a one-pager, as the deck's own card shape; '[]' for a memo.
  slides TEXT NOT NULL DEFAULT '[]',
  -- A memo's text; NULL for a teaser or a one-pager.
  memo TEXT CHECK ((format = 'memo') = (memo IS NOT NULL)),
  -- [{ ref, value }]: every figure the output states, each one the master's own.
  figures_json TEXT NOT NULL DEFAULT '[]',
  -- The proposal it was accepted from: one row per proposal.
  proposal_uid TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deck_derivatives_deck ON deck_derivatives (deck_id, created_at);
