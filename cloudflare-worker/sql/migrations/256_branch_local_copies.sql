-- 256 — the three things a branch reads that HQ owns, kept as dated copies.
--
-- WHY A COPY AND NOT A LOOKUP. Under D.2 a branch is its own Worker over its
-- own database, and the licence ledger, the promo ceiling and the cross-branch
-- benchmark all live in HQ's. A branch screen that had to reach HQ to render
-- its own licence summary would be a screen that goes blank when the service
-- binding is slow — and S6 draws that summary on Settings, which is the page
-- someone opens precisely when something is wrong. So HQ PUSHES, the branch
-- READS LOCAL, and every screen shows the copy's age rather than pretending it
-- is live. That is the same posture the canvases already take: the subsidiary
-- artboards say "as of <time>" beside every HQ-owned figure.
--
-- `pushed_at` IS NOT `created_at`, and the distinction is the point. It is the
-- moment HQ asserted this content, stamped BY HQ and carried across in the
-- push — not the moment this database happened to write the row. A row
-- rewritten by a retry keeps the assertion time it is a copy of, so "as of"
-- never gets younger than the fact behind it.
--
-- THESE TABLES ARE EMPTY ON HQ AND THAT IS CORRECT. They ship in the shared
-- schema because there is one schema and one codebase: a branch database is
-- bootstrapped from the same baseline HQ runs. On HQ nothing writes them —
-- `territory_licences` is the licence truth there, and reading a copy of your
-- own ledger would be a way to disagree with yourself. `routes/licence.ts`
-- reads the copy only when `BRANCH_CODE` is set.
--
-- NO FOREIGN KEYS to `territory_licences`, `licence_seats` or any HQ table.
-- Those tables exist in a branch database (same baseline) but are EMPTY there,
-- and a foreign key would make the push fail against rows that are, correctly,
-- not present. The licence's HQ identifiers are carried as plain values.

-- The one licence this deployment operates under. Singleton by construction:
-- a branch administers exactly one territory licence (D.5, and `licence_admins`
-- already carries UNIQUE(user_id) for the same reason), so a second row here
-- would be a push that silently half-applied rather than an error.
CREATE TABLE IF NOT EXISTS branch_licence (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  licence_uid     TEXT    NOT NULL,
  legal_entity    TEXT,
  brand_name      TEXT,
  -- Comma-separated ISO 3166-1 alpha-2, in HQ's order. Not a join table: a
  -- branch never queries "who holds BE", it only prints its own territory.
  territory       TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'active',
  -- Seats LICENSED, by licence type, as HQ granted them. Seats USED is the
  -- branch's own count and is deliberately not here.
  seats_json      TEXT,
  -- THE SAME TYPES THE LEDGER USES, and the reason is that a copy which
  -- converted would be a copy that loses. `territory_licences` (187) stores
  -- rates as integer BASIS POINTS — 3500 = 35% — and the fee as integer
  -- cents beside its ISO 4217 currency, because a rate held as a float
  -- cannot be compared for equality and an amount held as one is the defect
  -- `scripts/check-money-cents.mjs` exists to find. A branch renders what HQ
  -- asserted, so it holds it in the shape HQ asserted it in; the push is a
  -- column-for-column write with no arithmetic in it.
  revenue_share_bps INTEGER,
  token_split_bps   INTEGER,
  annual_fee_cents  INTEGER,
  currency        TEXT,
  term_start      TEXT,
  term_end        TEXT,
  renewal_at      TEXT,
  -- The master template version the licence agreement was instantiated from,
  -- so S5 can say which version this branch's contract carries even after HQ
  -- publishes a newer one.
  template_version TEXT,
  suspended_at    TEXT,
  suspended_note  TEXT,
  pushed_at       TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- What HQ will fund in promotions here, and what has been spent against it.
-- `issued_minor` is the BRANCH's own running total, not a pushed figure — the
-- ceiling is HQ's assertion, the spend is local fact, and keeping them in one
-- row is what lets a promo route refuse in a single read.
CREATE TABLE IF NOT EXISTS branch_promo_ceiling (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  period        TEXT    NOT NULL,
  ceiling_cents INTEGER NOT NULL DEFAULT 0,
  currency      TEXT    NOT NULL DEFAULT 'EUR',
  issued_cents  INTEGER NOT NULL DEFAULT 0,
  pushed_at     TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- S6's benchmarks: one row per metric, carrying the ANONYMISED median and the
-- n it was computed over — never a ranked list and never another branch's
-- figure. The canvas is explicit that a branch sees a tick against a median,
-- so a per-branch value has no column to live in here even by accident.
CREATE TABLE IF NOT EXISTS branch_benchmarks (
  metric_key   TEXT PRIMARY KEY,
  label        TEXT,
  -- A measured quantity whose meaning is in `unit` — a percentage, a count,
  -- a duration in days. Where a metric is monetary HQ sends it in minor
  -- units and `unit` says which currency, so this column is never a float
  -- amount of money.
  median_value REAL,
  unit         TEXT,
  -- How many branches went into the median. HQ withholds the row entirely
  -- below its own k-threshold; this column is what lets the screen say
  -- "n branches" rather than implying a population it does not know.
  n_branches   INTEGER,
  period       TEXT,
  pushed_at    TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_branch_benchmarks_period ON branch_benchmarks(period);
