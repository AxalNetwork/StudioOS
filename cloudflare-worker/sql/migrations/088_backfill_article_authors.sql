-- Task — Backfill Article Author Ownership.
--
-- The three already-published articles on axal.vc were seeded without being
-- linked to Guillaume's users.id. The author ACL in routes/articles.ts
-- (`loadOwned` + GET /draft/:id) keys off `articles.author_user_id`, so an
-- unowned article is invisible to him on /mine and rejected on open. The
-- access control is correct; only the seed data is wrong. This migration sets
-- author_user_id = the id of guillaumelauzier@gmail.com for those three slugs.
--
-- Apply with (verified working — D1 "studioos-db" is bound as DB in the
-- repo-root wrangler.toml; target it by name with --remote):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/088_backfill_article_authors.sql
-- (Applied to prod on 2026-06-11.)
--
-- Idempotent: the WHERE clause only touches rows whose author_user_id is not
-- already the target id (null-safe `IS NOT`), so re-running is a no-op. It also
-- guards against a missing user — if the email is not found the subquery is
-- NULL and the `IS NOT NULL` predicate makes the statement update zero rows
-- rather than violating the NOT NULL constraint on author_user_id.

UPDATE articles
   SET author_user_id = (SELECT id FROM users WHERE lower(email) = 'guillaumelauzier@gmail.com')
 WHERE slug IN (
         'how-ai-is-changing-startup-investment-and-venture-support',
         'why-i-avoid-consensus-and-invest-early',
         'cybersecurity-and-zero-trust-systems'
       )
   AND (SELECT id FROM users WHERE lower(email) = 'guillaumelauzier@gmail.com') IS NOT NULL
   AND author_user_id IS NOT (SELECT id FROM users WHERE lower(email) = 'guillaumelauzier@gmail.com');
