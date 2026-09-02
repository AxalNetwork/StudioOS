-- 203 — what an advisor sells, and what they charge for it.
--
-- WHAT IS MISSING TODAY. The Expertise canvas's Services zone lists an
-- advisor's offers — a fixed engagement, a package, a retainer — each with a
-- price and a scope. Nothing in the schema holds one. `service_offerings` is
-- the closest thing and it is the wrong subject twice over: it belongs to
-- PARTNERS (service providers), and migration 200 has just finished moving it
-- onto the shape the code reads. Bending it to a second owner would undo that.
--
-- INTEGER CENTS, NOT REAL DOLLARS. `service_offerings.price_usd` is declared
-- REAL and is grandfathered in `scripts/money-cents-baseline.json`. That
-- baseline is a ledger of debt, not a licence: converting the legacy half is a
-- data migration over live records and is not attempted, but a NEW table does
-- not get to pick the float dialect. `price_cents INTEGER` is the whole reason
-- `scripts/check-money-cents.mjs` runs on every push.
--
-- NULL PRICE IS A REAL STATE. An advisor who has written down an offer but not
-- yet a price has `price_cents IS NULL`, and that must render as "Not recorded"
-- rather than as free. A `NOT NULL DEFAULT 0` here would invent a fact — the
-- exact failure CLAUDE.md's funds honesty rule names — and zero is a price an
-- advisor may genuinely mean.
--
-- NO MONEY MOVES. This records what an advisor charges. It is not a checkout,
-- there is no payment provider behind it, and Axal takes no position on
-- collection. `billing_state` in 204 records what the advisor says happened;
-- nothing here settles anything.
--
-- `units_sold` IS NOT A COLUMN, deliberately. How many times a service was
-- delivered is derivable from `advisor_bookings`, and a stored counter is a
-- second source of truth that drifts the first time a booking is cancelled
-- outside the one code path that remembers to decrement it.

CREATE TABLE IF NOT EXISTS advisor_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'package', 'retainer')),
  duration_note TEXT,
  price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  scope TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advisor_services_advisor
  ON advisor_services(advisor_id, is_active);
