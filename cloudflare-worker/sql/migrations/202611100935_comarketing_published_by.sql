-- D5302 (#5302, package 3 of #4716) — who published a co-marketing pitch, kept
-- apart from who approved it.
--
-- Until now the publish route wrote the publisher into `reviewed_by_user_id`
-- and the publish time into `reviewed_at`, the same two columns the approval
-- had written, so a published pitch had lost who approved it and when. The
-- route now writes `published_at` (baseline) and this column instead, and
-- leaves the approval's actor and time where the approve route put them.
--
-- NO BACKFILL. A pitch published before this file has the publisher in
-- `reviewed_by_user_id` and no approval on record; its `published_by_user_id`
-- stays NULL, which is how the decision log tells such a pitch apart and
-- leaves it out rather than show its publish as its approval.
--
-- NOT idempotent (SQLite has no ADD COLUMN IF NOT EXISTS) — the ledger in
-- scripts/migrate-d1.mjs is what stops a replay.

ALTER TABLE comarketing_pitches ADD COLUMN published_by_user_id INTEGER REFERENCES users(id);
