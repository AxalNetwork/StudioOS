-- 219 — the firm an IC decision belongs to.
--
-- Company scoping, and the surface the rollout missed. Migration 123 created
-- `ic_decisions` before 189-198 put `company_id` on the tables that carry a
-- firm's private data, so the Commit stage kept the shape those stages were
-- written to fix: `created_by` says who typed it and nothing says whose it is.
--
-- WHAT THAT COST, before this file. `/api/ic` reads with no caller predicate at
-- all — `GET /api/ic` is literally `WHERE 1=1`, and `GET /api/ic/:uid` matches
-- on the uid alone — so any account holding the IC licence (admin, partner, or
-- a professional-tier investor) could read every other firm's investment memo,
-- proposed terms, and every member's vote with its written rationale.
-- `POST /api/ic/:uid/vote` was equally open: an outsider could cast a vote into
-- another committee's tally.
--
-- NOTHING LEAKED. `SELECT COUNT(*) FROM ic_decisions` on production is 0 and
-- `ic_votes` is 0 (checked 2026-09-08, before this migration was written). The
-- surface shipped ahead of its first user, which is why the backfill below has
-- nothing to do there and why this is a fix rather than an incident.
--
-- BACKFILL: mirrors 189, 193 and 194 exactly. A row lands in its author's
-- PRIMARY company (`user_company_links.is_primary_admin = 1`, oldest link
-- first). The id spaces line up directly — `ic_decisions.created_by` keys on
-- `users(id)`, as `user_company_links.user_id` does — and an author with no
-- primary company keeps NULL. Nothing is invented.
--
-- NULL MEANS "ONLY THE AUTHOR AND THE VOTERS", NOT "EVERYONE". This is the one
-- place this column reads differently from 189/193/194. There, `company_id` is
-- a NARROWING laid over an ownership predicate that already holds, so a NULL
-- row stays visible under every company and hides nobody's data. Here the
-- company IS the ownership key for a colleague, so `IS NULL OR = ?` would hand
-- every unassigned decision to every licence holder — the very leak being
-- closed. `icDecisionScope` in `services/tenancyScope.ts` therefore requires
-- `company_id IS NOT NULL` on that branch, and a decision whose author has no
-- company is readable by its author and by whoever has voted on it.
--
-- No transaction statements and no PRAGMA (see `scripts/check-sql-migrations.mjs`).

ALTER TABLE ic_decisions ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_ic_decisions_company
  ON ic_decisions(company_id);

UPDATE ic_decisions
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = ic_decisions.created_by
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;
