-- 227 — how a service is charged, and its price as an integer.
--
-- ══ THE TWO FACTS THE `po1` ARTBOARD ASKS FOR AND THE CATALOG DOES NOT HOLD ══
--
-- `service_offerings` is `title, category, summary, price_usd REAL, is_active`.
-- The artboard's instrument is `Service · Model · Price · Sold · What's
-- included`, and two of those five have nowhere to come from:
--
--   `Model` — Fixed, Retainer or Seat. The artboard's instNote is about exactly
--     this distinction: "Seat services price monthly and carry a granted scope;
--     fixed services price once. That distinction is the same one Delivery
--     reports progress against." `category` is free text about the SUBJECT of
--     the work (design, revops), not about how it is charged, and reading one
--     as the other would print "Fixed" over a retainer.
--
--   `Price` — as an integer. The artboard's instMeta says it out loud: "Prices
--     stored as integers, formatted once." `price_usd` is a REAL, which is the
--     defect `check-money-cents` exists to stop spreading and which this
--     schema's own `service_offerings_orphans_pre200` header already called
--     out: "a REAL is what made the original imprecise."
--
-- ══ WHY THE REAL COLUMN STAYS, AND WHAT KEEPS THE TWO HONEST ══════════════
--
-- `price_usd` is read in fifty-two places across the worker and the frontend.
-- Converting all of them is a change about money in code that has nothing to do
-- with this bucket, and a half-converted money column is worse than an
-- unconverted one. So `price_cents` becomes the CANONICAL value — the catalog
-- reads it and writes it — and the write path sets `price_usd` from it in the
-- same statement, so the legacy readers keep working and the two cannot part
-- company. `offering_price_sync.test.ts` fails the build if a write ever sets
-- one without the other.
--
-- ══ THE BACKFILL IS A READ, NOT AN UPDATE, AND THAT IS DELIBERATE ═════════
--
-- The obvious form here is `UPDATE service_offerings SET price_cents =
-- ROUND(price_usd * 100)`, and `check-migration-column-shapes` refuses it —
-- correctly. `service_offerings` is defined in more than one place, D1 keeps one
-- table per name, every definition is `IF NOT EXISTS`, and a migration that
-- READS `price_usd` cannot apply unless the definition carrying it happened to
-- win. Migration 200 rebuilds the table into a shape that has it, but that is a
-- fact about the sequence rather than about this file, and a guard that reasons
-- across files is a change to the guard, not to this migration.
--
-- So the resolution moves to the read: `serialize()` in `routes/services.ts`
-- returns `price_cents ?? Math.round(price_usd * 100)`. Every existing priced
-- row shows its price from the day this lands, the first write to a row stores
-- the integer properly, and no migration reads a column it cannot be sure of.
-- Rounding is the only lossless direction anyway: a float meant to be 48000.00
-- and stored as 47999.999999 rounds back to the cent a person typed.
--
-- ══ `Sold` AND `Booked to date` NEED NO COLUMN ════════════════════════════
--
-- `service_engagements` (migration 034) already carries `offering_id` and has a
-- real writer in `routes/services.ts`. So the artboard's `Sold` column is a
-- COUNT over it and `Booked to date` is that count against the price — both
-- joined rather than stored, which is the same rule migration 209 followed for
-- surface attribution: an engagement nobody linked is counted against nothing.
--
-- ══ NULLABLE, BOTH ════════════════════════════════════════════════════════
--
-- A service with no model recorded reads `Not recorded`, not "Fixed". A service
-- with no price is the artboard's Draft row, and its whole argument is that the
-- absence must show: "an invented number here would propagate straight into
-- lead scoring and into every proposal generated from the catalog."
--
-- SQLite accepts a CHECK on an added column and refuses UNIQUE or PRIMARY KEY;
-- this is a CHECK (verified against the engine, as 226's header notes).
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE service_offerings
  ADD COLUMN engagement_model TEXT
  CHECK (engagement_model IS NULL OR engagement_model IN ('fixed', 'retainer', 'seat'));

ALTER TABLE service_offerings
  ADD COLUMN price_cents INTEGER;

-- NO BACKFILL STATEMENT HERE, for the reason the header gives above: it would
-- read `price_usd`, and this table has more than one definition. A row priced
-- before this migration keeps a null `price_cents` in the database and gets its
-- integer form from `serialize()` on every read.
--
-- `All`, `Fixed`, `Retainer` and `Seat` narrow one firm's catalog by model.
--
-- THE INDEX LEADS WITH THE COLUMN THIS FILE ADDS, and not with
-- `(owner_user_id, engagement_model)`, which is the shape a reader would reach
-- for first. `owner_user_id` is absent from the `t13_t14_t15.sql` definition of
-- this table, so an index naming it cannot apply if that lineage is the one D1
-- kept — the exact failure `check-migration-column-shapes` exists to catch, and
-- the exact correction migration 196 made for `idx_offerings_company`. A column
-- an ALTER in this file just added is present whichever shape won.
CREATE INDEX IF NOT EXISTS idx_service_offerings_model
  ON service_offerings(engagement_model);
