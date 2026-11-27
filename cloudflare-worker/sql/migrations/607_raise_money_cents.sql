-- 607 — Capital relationships part 2: money in cents with a currency, and a
-- meeting's start with its Calendar item (D1190, #3124). Reserved for this part
-- by #3124.
--
-- MONEY. The raise stores kept dollars as REAL: `raise_prospects.amount`,
-- `raise_rounds.target_amount`, `raise_pro_rata.taking_amount`. Each gains an
-- exact whole number of cents beside it, and a currency:
--   raise_prospects  amount_cents, currency
--   raise_rounds     target_cents, currency
--   raise_pro_rata   taking_cents, currency
--   raise_closes     currency (a close records no amount of its own; the money
--                    in it is its prospects', which carry theirs)
-- Every existing amount was entered as dollars, so the currency of every
-- existing row is USD, as D1149 decided for deals (migration 599). One
-- currency per venture (#2457 owner question 5): the round's currency is the
-- venture's, and a read never sums two currencies.
--
-- THE COPY. Each cents column is copied once from its dollars:
-- CAST(ROUND(dollars * 100) AS INTEGER), only for an amount from 0 to ten
-- trillion dollars. A missing amount stays NULL, never 0; a negative or
-- out-of-range one stays NULL too, because no cents value would be true.
--
-- KEPT IN STEP. Every writer today still writes dollars (contacts.ts,
-- raiseWriters.ts, the Mercury credit, D653's round-call response). Instead of
-- changing twenty statements, a trigger per table recomputes the cents from the
-- dollars on every insert and every change of the dollars, by the same rule. A
-- cents column is therefore never older than its dollars. The triggers write
-- only the cents column, so D752's trigger on `amount` and `stage`
-- (migration 490) never fires from them.
--
-- MEETINGS. `raise_prospect_events` gains `starts_at` (an ISO 8601 instant,
-- UTC, for a meeting or call at a time) and `calendar_item_uid`, the stable id
-- the Calendar's "Investor meeting" item carries, unique where set.
--
-- Grep first (D689 D-t): none of these columns exists in an earlier migration
-- or in schema_baseline.sql, and no trigger on these tables writes cents.

ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0);
ALTER TABLE raise_prospects ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]');

ALTER TABLE raise_rounds ADD COLUMN target_cents INTEGER CHECK (target_cents IS NULL OR target_cents >= 0);
ALTER TABLE raise_rounds ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]');

ALTER TABLE raise_pro_rata ADD COLUMN taking_cents INTEGER CHECK (taking_cents IS NULL OR taking_cents >= 0);
ALTER TABLE raise_pro_rata ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]');

ALTER TABLE raise_closes ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]');

ALTER TABLE raise_prospect_events ADD COLUMN starts_at TEXT;
ALTER TABLE raise_prospect_events ADD COLUMN calendar_item_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_raise_prospect_events_calendar_item
  ON raise_prospect_events (calendar_item_uid) WHERE calendar_item_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raise_prospect_events_starts
  ON raise_prospect_events (starts_at) WHERE starts_at IS NOT NULL;

-- The copy, once.
UPDATE raise_prospects SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER)
 WHERE amount IS NOT NULL AND amount >= 0 AND amount <= 10000000000000;
UPDATE raise_rounds SET target_cents = CAST(ROUND(target_amount * 100) AS INTEGER)
 WHERE target_amount IS NOT NULL AND target_amount >= 0 AND target_amount <= 10000000000000;
UPDATE raise_pro_rata SET taking_cents = CAST(ROUND(taking_amount * 100) AS INTEGER)
 WHERE taking_amount IS NOT NULL AND taking_amount >= 0 AND taking_amount <= 10000000000000;

-- Kept in step, by the same rule, on every insert and every change of the dollars.
CREATE TRIGGER IF NOT EXISTS trg_raise_prospects_cents_ins
AFTER INSERT ON raise_prospects
BEGIN
  UPDATE raise_prospects
     SET amount_cents = CASE WHEN NEW.amount IS NOT NULL AND NEW.amount >= 0 AND NEW.amount <= 10000000000000
                             THEN CAST(ROUND(NEW.amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_raise_prospects_cents_upd
AFTER UPDATE OF amount ON raise_prospects
WHEN NEW.amount IS NOT OLD.amount
BEGIN
  UPDATE raise_prospects
     SET amount_cents = CASE WHEN NEW.amount IS NOT NULL AND NEW.amount >= 0 AND NEW.amount <= 10000000000000
                             THEN CAST(ROUND(NEW.amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_raise_rounds_cents_ins
AFTER INSERT ON raise_rounds
BEGIN
  UPDATE raise_rounds
     SET target_cents = CASE WHEN NEW.target_amount IS NOT NULL AND NEW.target_amount >= 0 AND NEW.target_amount <= 10000000000000
                             THEN CAST(ROUND(NEW.target_amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_raise_rounds_cents_upd
AFTER UPDATE OF target_amount ON raise_rounds
WHEN NEW.target_amount IS NOT OLD.target_amount
BEGIN
  UPDATE raise_rounds
     SET target_cents = CASE WHEN NEW.target_amount IS NOT NULL AND NEW.target_amount >= 0 AND NEW.target_amount <= 10000000000000
                             THEN CAST(ROUND(NEW.target_amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_raise_pro_rata_cents_ins
AFTER INSERT ON raise_pro_rata
BEGIN
  UPDATE raise_pro_rata
     SET taking_cents = CASE WHEN NEW.taking_amount IS NOT NULL AND NEW.taking_amount >= 0 AND NEW.taking_amount <= 10000000000000
                             THEN CAST(ROUND(NEW.taking_amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_raise_pro_rata_cents_upd
AFTER UPDATE OF taking_amount ON raise_pro_rata
WHEN NEW.taking_amount IS NOT OLD.taking_amount
BEGIN
  UPDATE raise_pro_rata
     SET taking_cents = CASE WHEN NEW.taking_amount IS NOT NULL AND NEW.taking_amount >= 0 AND NEW.taking_amount <= 10000000000000
                             THEN CAST(ROUND(NEW.taking_amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;
