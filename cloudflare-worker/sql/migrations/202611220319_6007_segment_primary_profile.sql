-- D6007 (#6007): Ideal customer profile V2 — the primary ICP, firmographics and disqualifiers on a segment.
--
-- `is_primary` marks the venture's one primary ICP. The partial unique index
-- below holds "exactly one per venture" in the store itself, so two writers
-- racing to set it cannot both win; the writer clears the old one and sets the
-- new one in one batch and logs the change. Archiving a segment clears it.
--
-- `firmographics_json` is a JSON array of {label, value} pairs (size range,
-- region, freight mode…) and `disqualifiers_json` a JSON array of short
-- phrases ("Under 20 staff"). Both are NULL until written, which every reader
-- shows as Not recorded; neither is ever derived from interviews.
--
-- Expand only: three nullable/defaulted columns and one index.

ALTER TABLE customer_segments ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1));
ALTER TABLE customer_segments ADD COLUMN firmographics_json TEXT;
ALTER TABLE customer_segments ADD COLUMN disqualifiers_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_segments_one_primary
    ON customer_segments (project_id) WHERE is_primary = 1;
