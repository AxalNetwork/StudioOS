-- 635 — Content queue: who approved an article (D1292, #3388, part 2 of #2383).
-- Assigned to #3388 by S21 for S1, 2026-10-26.
--
-- articles.approved_by — the admin whose approve moved the article to
--   `approved`, set by `POST /api/admin/articles/:id/approve` alongside
--   `approved_at`. Cleared, with `approved_at`, when an edit sends an approved
--   article back to Submitted (`PUT /api/articles/:id`), because that approval
--   was of a text that no longer exists.
--
-- Grep first (D689 D-t): no `approved_by` column exists on `articles` in an
-- earlier migration, in schema_baseline.sql or in `services/newsSchema.ts`
-- (the `approved_by` columns in 068_x_twitter, 436 and 563 are other tables).
-- Nothing is backfilled: an article approved before this migration has an
-- `approved_at` and no recorded approver, and the queue says Not recorded.

ALTER TABLE articles ADD COLUMN approved_by INTEGER REFERENCES users(id);
