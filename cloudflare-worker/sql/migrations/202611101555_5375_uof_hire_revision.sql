-- D5375 (#5375) — a planned hire has a revision, so a hire edited or removed from a
-- stale read is refused instead of replacing newer work (D5069 left hires out).
--
--   use_of_funds_hires.revision  starts at 0 and goes up by one on every edit of
--       the hire. A client reads it with the hire and sends it back as
--       `expected_revision`; an edit or a removal whose revision is not the stored
--       one changes no row and answers 409 `changed_since_open`.
--
-- Existing hires read 0.

ALTER TABLE use_of_funds_hires ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
