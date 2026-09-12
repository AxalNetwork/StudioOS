-- 240 — the rules that generate a calendar, the prices on it, and the links that fill it.
--
-- WHAT THE ARTBOARD ASKS FOR. `Advisor Detail · Practice.dc.html`'s PR4 frame
-- (line 333) is tagged **FEED**, and its blurb is the requirement in one line:
-- "The full calendar, the rules that generate it, and the booking links that
-- fill it." Three of those four nouns have no store. It draws an availability
-- card (`Weekly paid cap 6`, `Buffer between sessions 15 min`, `Minimum notice
-- 24 h`, `Blackout Fri afternoons`), a session-type price list (free intro,
-- $300 single, $1,250 pack, $4,500 retainer), three booking links with
-- different audiences, and a slot grid whose slots carry two states the schema
-- cannot express: a recording-consent chip and `HELD · UNPAID`.
--
-- WHY NEW TABLES, TABLE BY TABLE. The rule this repo runs on is that a store is
-- built only after every existing one has been read and found wanting, because
-- an earlier series found five of six "nothing stores this" claims to be false.
-- This time every candidate was read and the claim held:
--
--   `advisors` (201) — `hourly_rate_usd` and nothing else about money or time.
--   A rate on a profile is the advisor's default price, not a catalogue: it
--   cannot express a free intro capped at one per client, a pack sold over ten
--   weeks, or a retainer that bundles async. It says nothing about when a
--   session may be booked, so none of the four availability rules fit either.
--
--   `experts` (052) — EXACTLY the right columns and the wrong population. It
--   carries `pricing_model`, `hourly_rate_usd`, `first_session_free`,
--   `booking_url` and `calendly_url`, which is most of this artboard. It is the
--   WELLBEING directory: a separate table, keyed to its own `user_id`, listing
--   coaches and therapists matched by `services/wellbeing/match.ts`. An advisor
--   is not an expert row and writing one would put an advisory practice into
--   the wellbeing match pool. Its column DESIGN informs the two tables below;
--   its rows are a different product.
--
--   `advisor_office_hour_slots` (t13_t14_t15.sql:38) — the slot itself, and it
--   stays the slot. `capacity`, `meeting_url`, `notes`, `is_cancelled`: enough
--   to place an hour on a calendar, with nothing that says whether the hour may
--   be recorded or whether the booking that took it could be charged. Those two
--   are added here as columns rather than a side table, because both are facts
--   ABOUT a slot with exactly one value per slot.
--
--   `advisor_bookings` + 205 — `amount_cents` and `billing_state` record what a
--   session turned out to be worth AFTER it was booked. A session TYPE is the
--   price before anyone books, and the two differ on purpose: an advisor may
--   discount a single session without editing the catalogue.
--
--   `calendar_events` (235) — a kind-tagged event log, not an availability
--   generator. It records that something is scheduled, never the rule that
--   decided it could be.
--
-- THE PRICES HERE DO NOT CHARGE ANYONE YET, and the schema must not imply they
-- do. Migration 241 adds the take-rate and the payout account; the Stripe
-- Connect service leg that actually moves money lands after it, in test mode,
-- behind a production flag. Until that flag flips, a `price_cents` is what the
-- advisor asks for, and `payment_state` on a slot records why a booking could
-- not be charged — it never asserts that one was. See D75.
--
-- INTEGER CENTS. Same rule as 203 and 205, same reason:
-- `scripts/check-money-cents.mjs` exists so the float half of this schema stops
-- growing.
--
-- NO INDEX NAMES `advisor_bookings.advisor_id`. That table carries TWO
-- definitions — `sql/schema_baseline.sql:1002`'s six-column version and the
-- live `historical/t13_t14_t15.sql` one, recorded in
-- `scripts/sqlite-table-collisions-baseline.json` — and `advisor_id` exists
-- only in the second. 205's header explains the trap and
-- `scripts/check-migration-column-shapes.mjs` was written to stop it after
-- migration 196 shipped exactly that mistake. Nothing below indexes that table.
--
-- NO BEGIN/COMMIT. D1 rejects transaction statements in a migration file
-- (migration 200 shipped them once; `scripts/check-sql-migrations.mjs` guards
-- it now).

-- ── Availability: the rules that decide how many slots exist at all ─────────
-- ONE ROW PER ADVISOR. The artboard's own note is the reason this is a rule
-- set and not a property of each slot: "The rules above govern how many slots
-- exist at all, not which of these are taken: the cap ceilings a week at 6
-- paid, and the blackout is why no Friday afternoon appears here to begin
-- with."
CREATE TABLE IF NOT EXISTS advisor_availability_rules (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id          INTEGER NOT NULL UNIQUE,
  -- NULL is "no cap set", which is different from a cap of 0 ("accept no paid
  -- sessions"). D56/D68: an unset rule reads as absent, never as a limit the
  -- advisor did not choose.
  weekly_paid_cap     INTEGER,
  buffer_minutes      INTEGER,
  min_notice_hours    INTEGER,
  -- JSON array of recurring windows, e.g. [{"day":"fri","from":"12:00","to":"18:00"}].
  -- A blackout is a CALENDAR-DAY-AND-CLOCK rule in the advisor's own timezone,
  -- not an instant: storing it as a timestamp would drift an hour twice a year.
  blackouts_json      TEXT NOT NULL DEFAULT '[]',
  timezone            TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Session types: the catalogue a booking link sells ──────────────────────
CREATE TABLE IF NOT EXISTS advisor_session_types (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  advisor_id          INTEGER NOT NULL,
  name                TEXT NOT NULL,
  duration_minutes    INTEGER,
  -- The artboard's second line under each name: "one per client", "over 10
  -- weeks", "2 sessions + async". Free text because it describes a commercial
  -- arrangement, not a schedule the system enforces.
  cadence_note        TEXT,
  -- NULL means unpriced, NOT free. `is_free_intro` is what says free, so that
  -- "the advisor has not set a price" and "this one costs nothing" stay
  -- distinguishable — 205 made the same distinction for `amount_cents` and for
  -- the same reason.
  price_cents         INTEGER,
  is_free_intro       INTEGER NOT NULL DEFAULT 0,
  -- The canvas caps the free intro at one per client. Enforced in the route,
  -- recorded here so the rule travels with the type rather than living only in
  -- code.
  once_per_client     INTEGER NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_session_types_advisor
  ON advisor_session_types(advisor_id, sort_order);

-- ── Booking links: the same calendar, three different audiences ────────────
CREATE TABLE IF NOT EXISTS advisor_booking_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  advisor_id          INTEGER NOT NULL,
  -- The path segment after /b/, e.g. 'priyanka/cohort-4'. UNIQUE across the
  -- table because it is resolved from the URL alone.
  slug                TEXT NOT NULL UNIQUE,
  session_type_id     INTEGER REFERENCES advisor_session_types(id) ON DELETE SET NULL,
  -- 'public'  — on the advisor's profile, anyone may book
  -- 'cohort'  — restricted to a named cohort, and the canvas notes it
  --             "Bypasses the paid gate"
  -- 'private' — the link is the only way in
  audience            TEXT NOT NULL DEFAULT 'public'
                      CHECK (audience IN ('public', 'cohort', 'private')),
  cohort_ref          TEXT,
  -- Mirrors the canvas's "Requires a verified payout account." A link whose
  -- type has a price cannot be honoured until money can be taken, and the note
  -- under the link is where a reader learns that BEFORE clicking.
  requires_payout_account INTEGER NOT NULL DEFAULT 0,
  note                TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_booking_links_advisor
  ON advisor_booking_links(advisor_id, is_active);

-- ── Two facts about a slot the slot table cannot hold ──────────────────────
-- SQLite/D1 has no ADD COLUMN IF NOT EXISTS. These are additive and the
-- runner tolerates a duplicate-column error on replay, same as 205.
--
-- `recording_state` — the artboard draws a "Recording" chip on some slots and
-- not others, and PR3's AI band already depends on the distinction: its own
-- note says sessions without consent are "excluded from the batch, not
-- silently summarized". 'none' is the default because consent that was never
-- given is not consent.
ALTER TABLE advisor_office_hour_slots ADD COLUMN recording_state TEXT NOT NULL DEFAULT 'none'
  CHECK (recording_state IN ('none', 'requested', 'consented', 'declined'));

-- `payment_state` — why a booked slot is not chargeable. 'held_unpaid' is the
-- canvas's own case, and its note is the reason this column exists rather than
-- the slot being quietly booked: "A slot that silently fails to charge is
-- worse than one that says so." 'not_applicable' is the default and covers
-- every free and unpriced slot, which today is all of them.
ALTER TABLE advisor_office_hour_slots ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK (payment_state IN ('not_applicable', 'held_unpaid', 'authorized', 'charged', 'refunded'));

-- `blocked_reason` — the canvas counts "1 manually blocked" separately from
-- booked and from held. `is_cancelled` cannot carry it: a cancelled slot was
-- booked and then undone, a blocked one was never offered.
ALTER TABLE advisor_office_hour_slots ADD COLUMN blocked_reason TEXT;
