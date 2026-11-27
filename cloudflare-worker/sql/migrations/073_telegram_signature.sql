-- 073_telegram_signature.sql
-- Per-channel human author signature appended to MarkdownV2 body at send
-- time. Worker carries `ensureTelegramSchema()` lazy bootstrap (mirrors the
-- 067 pattern in replit.md), so this migration is documentation/parity for
-- fresh environments. Already applied to prod 2026-05-25 via wrangler d1
-- execute --remote.
--
-- D1/SQLite has no ADD COLUMN IF NOT EXISTS, so replay-safety lives in the
-- lazy bootstrap (`ensureTelegramSchema` does a PRAGMA table_info() check
-- before ALTER). This file is therefore a one-shot — DO NOT re-run on a
-- DB that already has the column. The lazy bootstrap is the canonical
-- idempotent path; this file exists only for fresh-env parity per the
-- repo's additive-migration convention.
ALTER TABLE telegram_channels ADD COLUMN signature TEXT;
UPDATE telegram_channels SET signature = 'Guillaume Lauzier' WHERE signature IS NULL;
