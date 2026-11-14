-- 541 / D900 / #2679: a deck review names the studio version it reviewed.
-- Assigned by S1 on #2679 (D894's slot table, part 6). Additive. No BEGIN/COMMIT.
--
-- Until now a review was the reviewer's own: an upload or pasted text, kept per
-- user (`routes/deck_reviewer.ts`), with nothing tying it to a deck in the
-- studio. `POST /api/decks/:id/review` (`routes/deck_review.ts`) reviews one
-- version's own text and records which:
--
--   deck_id       the `pitch_decks` row (one version) that was reviewed; NULL for
--                 every upload and pasted text, which stay as they are.
--   deck_version  that row's `version`, kept so the history reads "v4".
--
-- The run itself is in `deck_review_history` (one row per run, as the reviewer
-- already writes it), and its cost is the run's own `ai_usage_logs` row, found
-- by `record_ref = 'deck_review:<id>'`, so no cost column is added here.
ALTER TABLE deck_reviews ADD COLUMN deck_id INTEGER;
ALTER TABLE deck_reviews ADD COLUMN deck_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_deck_reviews_deck ON deck_reviews (deck_id, created_at);
