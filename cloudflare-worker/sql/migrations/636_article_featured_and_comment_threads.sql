-- 636 — Content queue part 3: featured, comment replies, who resolved, edited
-- (D1293, #3389). Assigned to #3389 by S21 for S1, 2026-10-26 (D1290 §5).
--
-- articles.featured_at / featured_by — when a Super Admin featured the
--   article on Articles, and who. Both NULL means not featured. Written only
--   by `routes/admin_articles.ts` (POST /:id/feature), which holds at most
--   three at a time and clears both on unpublish. The public featured strip
--   (`routes/articles.ts`) reads `featured_at`; a `"featured"` tag no longer
--   counts (D1290 §4, question 4).
-- article_review_comments.parent_id — the comment this one answers. NULL for
--   a comment that starts a thread. One level only: a reply's parent is
--   always a thread's first comment.
-- article_review_comments.resolved_by — the admin who resolved the thread.
--   NULL while open, and for a thread resolved before this migration.
-- article_review_comments.edited_at — when the text last changed after it
--   was posted. NULL for a comment never edited.
--
-- Grep first (D689 D-t): no `featured_at` or `featured_by` column exists on
-- `articles`, and no `parent_id`, `resolved_by` or `edited_at` column on
-- `article_review_comments`, in an earlier migration or in
-- schema_baseline.sql. Nothing is backfilled: no Super Admin has featured an
-- article yet, and an article an author tagged "featured" was never a
-- Super Admin's pick. Who resolved an older thread, and whether an older
-- comment was edited, were never recorded, and NULL says so.

ALTER TABLE articles ADD COLUMN featured_at TEXT;
ALTER TABLE articles ADD COLUMN featured_by INTEGER REFERENCES users(id);
ALTER TABLE article_review_comments ADD COLUMN parent_id INTEGER REFERENCES article_review_comments(id) ON DELETE CASCADE;
ALTER TABLE article_review_comments ADD COLUMN resolved_by INTEGER REFERENCES users(id);
ALTER TABLE article_review_comments ADD COLUMN edited_at TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(featured_at) WHERE featured_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_article_comments_parent ON article_review_comments(parent_id) WHERE parent_id IS NOT NULL;
