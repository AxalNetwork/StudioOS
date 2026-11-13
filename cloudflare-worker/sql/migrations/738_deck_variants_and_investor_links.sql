-- 738 — D1565 (#3812, deck builder v2 D4): per-investor links and tailored
-- variants, on the existing per-prospect links (migration 463's
-- `pitch_deck_share_tokens.prospect_id` / `investor_label`), not a second
-- link store.
--
--   deck_variants                       one tailored order of a frozen deck
--                                       version for an investor: the
--                                       investor's stated thesis, the slide
--                                       order and the emphasis plan. A
--                                       variant only reorders and emphasises
--                                       the master's own slides, so it never
--                                       holds a figure the master lacks.
--   pitch_deck_share_tokens.variant_id  the variant a link opens, or NULL for
--                                       the master version.
--   pitch_deck_share_tokens.watermark_text
--                                       the recipient watermark ("Prepared
--                                       for [investor] · [fund]"), written
--                                       when the link is made; NULL for a link
--                                       made before this or with no recipient.
--
-- Withdraw stays D1111's `revoked_at`: a withdrawn link refuses to open, and
-- its views and conversions are kept.
--
-- Additive: ADD COLUMN with a NULL default and CREATE TABLE IF NOT EXISTS.
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): the ledger runner
-- applies it once.

CREATE TABLE IF NOT EXISTS deck_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- The frozen master: one `pitch_decks` row, which is one version.
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  prospect_id INTEGER REFERENCES raise_prospects(id) ON DELETE SET NULL,
  -- { sectors: [], anti_sectors: [], stages: [] }: what the investor states, as entered.
  thesis_json TEXT NOT NULL DEFAULT '{}',
  -- [3, 0, 1, …]: the master's slide indexes in this variant's order; a
  -- slide left out is moved to the end, never dropped.
  slide_order_json TEXT NOT NULL DEFAULT '[]',
  -- { "<slide index>": "lead" | "appendix" }: what the plan emphasises.
  emphasis_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deck_variants_deck ON deck_variants (deck_id);

ALTER TABLE pitch_deck_share_tokens ADD COLUMN variant_id INTEGER REFERENCES deck_variants(id) ON DELETE SET NULL;
ALTER TABLE pitch_deck_share_tokens ADD COLUMN watermark_text TEXT;
