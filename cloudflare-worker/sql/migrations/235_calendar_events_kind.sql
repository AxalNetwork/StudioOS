-- 235 — give `calendar_events` the columns two of its three writers already use.
--
-- WHAT IS BROKEN. `calendar_events` was created by 018_calendly_integration as
-- the Calendly projection: `user_id`, `source` and `external_uri` are NOT NULL
-- with no default, and there is NO `kind` column. Migration 062's header
-- promised a lazy PRAGMA add for the extra columns "in a separate migration in
-- follow-up Task #58". That migration was never written, and no
-- `ALTER TABLE calendar_events` exists anywhere in the repository.
--
-- Two writers were built against the shape that was promised rather than the
-- shape that exists, so both throw on every call:
--
--   · services/wellbeing/bookings.ts — a CONFIRMED, PAID expert booking. It
--     also declares its own version of the table in a different shape first,
--     guarded IF NOT EXISTS, which is a no-op because the table already
--     exists — so the mismatch stays invisible until the INSERT.
--     (That declaration is not spelled out here: check-migration-column-shapes
--     parses this file for table definitions and would read the example as a
--     fourth one, with no columns.)
--   · routes/calendar.ts — the manual-event writer, which inserts `kind`.
--
-- NO CHECK ON `kind`. SQLite's ALTER TABLE … ADD COLUMN cannot carry one, so
-- the live column has none and the ROUTE is the only place the closed set is
-- enforced — `KNOWN_KINDS` in services/calendar.ts. Adding a CHECK here would
-- also mean rebuilding the table, which is not worth it for a column whose
-- writers are all in one file.
--
-- NO `IF NOT EXISTS` — D1 does not support it on ADD COLUMN — and no
-- BEGIN/COMMIT, which D1 rejects outright. One statement per line so a re-run
-- fails loudly on the first duplicate rather than half-applying.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/235_calendar_events_kind.sql

ALTER TABLE calendar_events ADD COLUMN kind TEXT;

-- The originating row in the kind's own table. `source_id` is the integer key
-- and `source_uid` the public uid; the Calendly rows predate both and keep
-- using `external_id` / `external_uri`, which is why these are nullable rather
-- than a rename of those.
ALTER TABLE calendar_events ADD COLUMN source_id INTEGER;
ALTER TABLE calendar_events ADD COLUMN source_uid TEXT;

-- Attendees as JSON. `organizer_email` / `invitee_email` model exactly two
-- people, which is right for a Calendly booking and wrong for an IC meeting;
-- the aggregator already returns an `attendees` array for every other kind.
ALTER TABLE calendar_events ADD COLUMN attendees_json TEXT;

-- The aggregator reads this table twice: once for Calendly (`source =
-- 'calendly'`) and once for everything else by `kind`. The second read had no
-- index at all.
CREATE INDEX IF NOT EXISTS idx_calendar_events_kind_time
  ON calendar_events(user_id, kind, start_at);
