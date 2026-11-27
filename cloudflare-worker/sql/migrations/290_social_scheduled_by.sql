-- 290 — who scheduled a Telegram or X post (D250).
--
-- WHAT WAS MISSING. Both consoles let a Super Admin schedule a post, and until
-- D250 nothing ever sent one. The scheduled handler now does, and every send
-- writes an audit row naming an accountable admin. For a click that is the
-- admin who clicked. For the clock it is whoever SCHEDULED the post, and no
-- column held that: `created_by` records who drafted it, which can be a
-- different person, and the scheduler was only in the free JSON of a
-- `*_post_scheduled` audit row. The schedule route now writes it here.
--
-- NULLABLE, WITH NO DEFAULT. A row scheduled before this column existed has
-- nobody to backfill from. Production held no scheduled row of either kind
-- when this was written (2026-09-24: 19 Telegram drafts, no X posts), and the
-- sweep reads a NULL as "fall back to created_by" and says so in the audit.
--
-- Declared here AND ensured at runtime by services/telegramSchema.ts and
-- services/xSchema.ts in the same commit (D235: a runtime ADD COLUMN is a
-- safety net for a declared column, never its only declaration).
--
-- No BEGIN/COMMIT: D1 rejects transaction control in a migration file (#26).

ALTER TABLE telegram_posts ADD COLUMN scheduled_by INTEGER REFERENCES users(id);
ALTER TABLE x_posts ADD COLUMN scheduled_by INTEGER REFERENCES users(id);
