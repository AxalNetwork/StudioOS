-- 223 — a comparable range for one of the firm's own service lines, with its
-- run date and the number of comparables behind it.
--
-- ══ THE OBJECT THIS ZONE IS ABOUT, AND WHAT WAS THERE INSTEAD ══════════════
--
-- `/research/markets` mounted `SignalsPage` — the `market_intel_rows` sector
-- feed, 197k rows and ingesting daily. The `pr3` artboard is about something
-- else entirely: what comparable engagements go for, per service line the firm
-- sells, so a client can be shown the reasoning behind a quoted number. Its
-- table is `Reading · Comparable range · Run date · Age · Proposal attachment`
-- and its rows are "Design system build — $38,000 – $62,000, Aug 28, eleven
-- comparables". A sector signal is not a price, and no amount of layout makes
-- one into the other.
--
-- The feed keeps its own route, `/signals`, which is already mounted for every
-- licence that had it. Nothing is retired; it is no longer answering a question
-- it was not about.
--
-- ══ A READING IS ENTERED, NOT GENERATED, AND THAT IS THE HONEST SHAPE ══════
--
-- There is no comparables database in this product. A `Re-run stale` that
-- called a model and produced "$38,000 – $62,000" would be inventing a market
-- figure in the exact voice a researched one uses — the failure D9/D12 withdrew
-- four tabs for, with a currency symbol in front of it. So a reading is what
-- the firm found, recorded by the firm, and `research_benchmarks` (migration
-- 217) is the precedent: a peer figure is refused without its source and its
-- sample size, by the schema's own CHECK.
--
-- The same rule here. A range without `comparable_count` is a number with no
-- basis, and a range without `ran_at` cannot age — and age is the whole point
-- of this artboard, which blocks a stale reading from a proposal rather than
-- merely labelling it. The CHECK refuses both.
--
-- ══ WHY IT HANGS OFF `service_offerings` ══════════════════════════════════
--
-- The artboard's rows ARE the firm's catalog: design system build, sprint team,
-- fractional seat, brand refresh, retainer. And its fourth tile reads `Retainer
-- rate · Not recorded · never run — matches the unpriced catalog draft`, which
-- is the join said out loud: an offering with no reading is the same gap the
-- catalog shows from the other side.
--
-- So a reading points at an offering and the page lists offerings, joining the
-- newest reading for each. An offering with none is the "never run" row — a
-- fact about the firm's own record (D68), which is why that cell is drawn as
-- `Not recorded` rather than left out.
--
-- Cents, integer, as `check-money-cents` requires and as every price in this
-- schema is.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS research_market_readings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  owner_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The service line this is a price for. Nullable so a firm can record a
  -- reading for something it has not catalogued yet; the page then shows it
  -- under its own label rather than dropping it.
  offering_id       INTEGER REFERENCES service_offerings(id) ON DELETE CASCADE,
  -- What was read, in the firm's own words when there is no offering behind it.
  metric            TEXT NOT NULL,
  range_low_cents   INTEGER NOT NULL,
  range_high_cents  INTEGER NOT NULL,
  -- How many comparable engagements the range was drawn from. NOT NULL because
  -- a range with no basis is a number a client will ask about and the firm
  -- cannot answer — and because the artboard prints it under every run date.
  comparable_count  INTEGER NOT NULL,
  -- When the firm did the work. Age is computed from this and from nothing
  -- else: `updated_at` moves when a row is touched, which would make every
  -- reading look current the moment anyone edited one.
  ran_at            TEXT NOT NULL,
  -- What the range is for — "Design & product services". Free text; a firm's
  -- market is its own to name.
  scope             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- A range that runs backwards is a typo, and one a client would be shown.
  CHECK (range_high_cents >= range_low_cents),
  -- The two facts without which it is not a reading. `research_benchmarks`
  -- refuses a peer figure on the same grounds.
  CHECK (comparable_count > 0)
);

-- "My readings, newest run first" is the only read; the page groups by offering
-- and takes the newest of each.
CREATE INDEX IF NOT EXISTS idx_research_market_readings_owner
  ON research_market_readings(owner_user_id, ran_at DESC);
