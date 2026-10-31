-- 750 — a version number on each saved Studio layout (D1594, #3863), so a save
-- made from a stale copy is refused (409 stale_layout).
--
-- `revision` is 1 on a layout's first save and goes up by one on each later
-- save. `updated_at` is `datetime('now')`, accurate only to the second, so it
-- cannot serve as a version. A row saved before this migration reads 1. Reset
-- deletes the row, so the next save starts again at 1. Additive only, as
-- 691_stripe_mode_stamps.sql does it.
ALTER TABLE studio_layouts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
