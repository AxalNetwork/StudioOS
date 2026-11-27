-- 260 — what each subsidiary owes HQ, and the figures it reported (D111).
--
-- H5's statements zone said, in the payload's own words, "No subsidiary
-- statement store exists. `engagement_invoices` bills an engagement, not a
-- licensee, so what each subsidiary owes HQ this quarter has never been
-- recorded." That was true and is what these two tables end.
--
-- TWO TABLES, BECAUSE THEY HAVE DIFFERENT AUTHORS AND DIFFERENT TRUST.
-- `subsidiary_usage_reports` is what a BRANCH said about itself, arriving over
-- the RPC surface with its own `reported_at`; `subsidiary_statements` is HQ's
-- own ledger row, which HQ computes and edits. Folding them into one table
-- would make "the branch says it billed €40,000" and "HQ has decided it owes
-- €14,000" the same fact with the same authority, and the whole point of a
-- statement is that the second is a decision somebody at HQ can be held to.
--
-- OWED IS COMPUTED AND STORED, NOT DERIVED ON READ — the opposite of the SLA
-- band (D108) and for the opposite reason. A band is a view of a date that
-- must stay current; an owed figure is a CLAIM, agreed against a revenue share
-- that can be re-termed next quarter. Recomputing it later from today's share
-- would silently restate a statement someone has already paid against, which
-- is the same failure D110's stored contract body exists to prevent.
--
-- PAID AND DISPUTED ARE HQ-ENTERED, and this is v1 (D.8). Nothing reconciles
-- them against Stripe: `paid_cents` is what an HQ operator recorded receiving,
-- with `paid_note` for the reference. An automatic figure would need HQ to be
-- a Stripe Connect platform with each branch a connected account, which is
-- real work and not this.
--
-- MONEY IS INTEGER CENTS AND RATES ARE INTEGER BASIS POINTS, per migration
-- 187 and the money guard. CURRENCY IS PER ROW and never summed across:
-- licences are denominated per licence, so a platform total would be wrong by
-- whatever the rate happens to be, quoted to the cent.
--
-- NO FOREIGN KEY to `territory_licences`, matching 256, 258 and 259: the uid
-- is carried as a plain value because these rows arrive from a branch whose
-- ledger row may not be readable in the same transaction, and a constraint
-- that rejected a usage report would lose the report rather than protect it.

-- One row per (licence, period, stream) — what the BRANCH reported.
CREATE TABLE IF NOT EXISTS subsidiary_usage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licence_uid TEXT NOT NULL,
  branch_code TEXT NOT NULL,
  -- 'YYYY-Qn'. A quarter, because that is the grain the canvas's statements
  -- zone draws and the grain a revenue share is agreed at.
  period TEXT NOT NULL,
  --   subscriptions — the branch's own billing
  --   licence_fees  — fees the branch itself charged onward, if any
  --   token_margin  — an ESTIMATE, see below
  --   other
  stream TEXT NOT NULL,
  -- NULLABLE, AND THAT IS THE WHOLE POINT OF THE COLUMN. A branch that cannot
  -- measure a stream is the NORMAL case here, not an edge one — it cannot
  -- total its own subscription revenue at all — so "unknown" must be storable.
  -- `NOT NULL DEFAULT 0` was the first draft and the RPC test caught it on the
  -- first report: the insert threw, and the only way to make it succeed would
  -- have been to write a 0, which is the exact falsehood the rest of this file
  -- is built to prevent.
  gross_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR',
  -- TRUE when the branch could not measure this and estimated it. Token
  -- margin is the case that exists today: AI Gateway reports a COST and
  -- nothing records what tokens were billed at, so a margin is inferred.
  -- A figure marked estimated must never be presented as invoiced.
  is_estimate INTEGER NOT NULL DEFAULT 0,
  estimate_basis TEXT,
  -- When the BRANCH said it, not when HQ read it. A statement built from a
  -- three-week-old report is a different claim from one built this morning,
  -- and the screen shows the age.
  reported_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A re-report REPLACES the figure for that (licence, period, stream) rather
-- than adding a second row, because a branch correcting itself is a
-- correction and not a second quarter's trading.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_reports_once
  ON subsidiary_usage_reports(licence_uid, period, stream);
CREATE INDEX IF NOT EXISTS idx_usage_reports_period ON subsidiary_usage_reports(period);

-- One row per (licence, period) — HQ's ledger.
CREATE TABLE IF NOT EXISTS subsidiary_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  licence_uid TEXT NOT NULL,
  period TEXT NOT NULL,
  -- The total of the reports this statement was drawn from, and the share it
  -- was drawn at. BOTH are stored: a statement that kept only the answer
  -- could not be explained, and one that kept only the inputs would restate
  -- itself when the licence is re-termed.
  gross_cents INTEGER NOT NULL DEFAULT 0,
  revenue_share_bps INTEGER NOT NULL DEFAULT 0,
  owed_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  -- THE BREAKDOWN THIS WAS DRAWN FROM, as JSON:
  --   [{ stream, gross_cents, currency, available, is_estimate, reason }]
  --
  -- A STATEMENT MUST BE ABLE TO EXPLAIN ITSELF, and the streams it could NOT
  -- read are the half that matters. Measured against the schema on 2026-09-15:
  -- a branch cannot total its subscription revenue from local tables at all —
  -- `account_subscriptions` carries a plan and a status and no amount, and the
  -- charges live in the Stripe API — and `ai_usage_logs` gives a token COST
  -- with nothing recording what tokens were billed at. So a statement drawn
  -- today is drawn over streams that are partly unavailable, and one storing
  -- a single `gross_cents` would present a partial figure as the whole trade.
  -- The counts below are derived from this array and stored beside it so a
  -- list view can sort and filter without parsing every row.
  streams_json TEXT NOT NULL DEFAULT '[]',
  -- Streams the branch reported as inferred rather than measured.
  estimated_streams INTEGER NOT NULL DEFAULT 0,
  -- Streams nobody could report at all. Non-zero means this statement is
  -- INCOMPLETE, not that those streams earned nothing, and every surface that
  -- shows the owed figure has to show this beside it.
  unreported_streams INTEGER NOT NULL DEFAULT 0,
  -- HQ-entered, both of them (D.8).
  paid_cents INTEGER NOT NULL DEFAULT 0,
  paid_note TEXT,
  paid_by_user_id INTEGER,
  paid_at TEXT,
  disputed_cents INTEGER NOT NULL DEFAULT 0,
  dispute_note TEXT,
  --   draft  — drawn, not sent
  --   issued — sent to the subsidiary
  --   paid   — settled in full
  --   void   — withdrawn
  status TEXT NOT NULL DEFAULT 'draft'
         CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  -- The newest `reported_at` of the reports this was drawn from, so the age
  -- of the evidence travels with the claim.
  reports_as_of TEXT,
  drawn_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_statements_once
  ON subsidiary_statements(licence_uid, period);
CREATE INDEX IF NOT EXISTS idx_statements_status ON subsidiary_statements(status, period);

-- The promo ceiling HQ sets per licence, which the branch reads as a pushed
-- copy in `branch_promo_ceiling` (migration 256).
--
-- WHY A CEILING AND NOT A BUDGET. `promo_codes` carries a discount and an
-- optional redemption cap per code and allocates nothing; the canvas asks for
-- HQ to set a spend ceiling that a subsidiary issues within. `issued_cents`
-- is what the BRANCH reports having issued against it — HQ never computes it,
-- because HQ cannot see the branch's codes.
CREATE TABLE IF NOT EXISTS licence_promo_ceilings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licence_uid TEXT NOT NULL,
  period TEXT NOT NULL,
  ceiling_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  -- Reported by the branch, null until it has. NOT zero: "the branch has
  -- issued nothing" and "the branch has not told us" are different, and a
  -- zero would make an unreported ceiling look fully available.
  issued_cents INTEGER,
  issued_reported_at TEXT,
  set_by_user_id INTEGER,
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_ceiling_once
  ON licence_promo_ceilings(licence_uid, period);
