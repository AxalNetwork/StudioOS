-- 234 — what changed between proposal versions, and why a proposal was lost.
--
-- ══ THE `p2` ARTBOARD ASKS FOR TWO RECORDS AND `quotes` HOLDS NEITHER ══════
--
-- `quotes` is one row per (need, partner) with one price and one status. A
-- proposal in real life is not that: it is v1 through v4, each one a concession
-- or a restructure, and the artboard's `Version history · Verwood` panel is
-- about exactly that sequence — "Split into 3 phases, same total", "Two phases,
-- $41,000", "Signed at $48,000". None of it is derivable from a row that gets
-- overwritten on every edit.
--
-- And a lost proposal loses for a REASON. `quotes.status` says `rejected` and
-- stops; the artboard's `Loss reasons` panel is a taxonomy chart, with its own
-- note on why: "reasons are picked from a fixed taxonomy, not typed. Free text
-- would make this chart unreadable within a quarter."
--
-- ══ THE TAXONOMY IS THE ONE `partner_lead_passes` ALREADY USES ════════════
--
-- Migration 233 gave a pass a closed set of reasons — `below_floor`,
-- `no_capability`, `scope_mismatch`, `timing`, `price`, `other`. A loss is a
-- different event (we bid and they said no; a pass is a bid never made) but the
-- REASONS overlap almost entirely, and P5 groups both. So a loss takes the same
-- vocabulary minus the two that cannot apply to a bid you actually made: you do
-- not lose a deal because it was below your own floor, and you do not lose it
-- for a capability you just quoted on. One vocabulary, two tables, one chart.
--
-- THE SET IS ENFORCED IN THE ROUTE, NOT HERE, and that is a SQLite limit rather
-- than a decision: `ALTER TABLE … ADD COLUMN` cannot carry a CHECK, and the
-- alternative — rebuilding `quotes` to add one — would rewrite a core table
-- every licence reads for a constraint one writer can hold. `PUT
-- /pipeline/proposals/:quoteId/outcome` is the only path that sets this column,
-- and it refuses anything outside `LOSS_REASONS`. The chart's readability
-- depends on that route staying the only writer, which is worth knowing when
-- the next one is written.
--
-- ══ VERSIONS ARE APPEND-ONLY AND THE QUOTE STAYS THE CURRENT ONE ══════════
--
-- `quotes.price` is still the live figure; this table is the trail behind it. A
-- version row is never edited — that is the whole point of a history — and the
-- unique index makes v2 unable to exist twice. The price is INTEGER CENTS, the
-- dialect every new money column in 208 and 209 takes, even though
-- `quotes.price` beside it is grandfathered REAL dollars: a new column takes
-- the new rule, and the reader converts rather than the schema drifting.
--
-- ══ `loss_reason` IS AN ALTER, AND THE INDEX LEADS WITH IT ════════════════
--
-- `quotes` is defined in more than one historical file, so a migration that
-- READ a column only some of those definitions carry would trip
-- `check-migration-column-shapes`. The index below leads with `loss_reason`,
-- which is the column this migration adds — the shape migrations 196, 227, 228,
-- 229 and 230 all use for the same reason.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE quotes ADD COLUMN loss_reason TEXT;

-- THE INDEX IS ON `loss_reason` ALONE, and the second column it wanted is why.
-- `(loss_reason, partner_id)` reads `quotes.partner_id`, which two of the four
-- historical definitions of this table do not carry — `check-migration-column-
-- shapes` caught it, correctly: D1 keeps ONE table per name and every
-- definition is `IF NOT EXISTS`, so whichever ran first won, and a migration
-- naming a column only some of them have cannot be relied on to apply. Leading
-- with the ALTER-added column is necessary and was not sufficient; every other
-- column in the statement has to be universal too. Partner scoping already has
-- `idx_quotes_partner (partner_id, status)` from t13_t14_t15.
CREATE INDEX IF NOT EXISTS idx_quotes_loss_reason
  ON quotes(loss_reason);

CREATE TABLE IF NOT EXISTS quote_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  -- 1, 2, 3 … The artboard renders it as `v3`; the number is stored.
  version INTEGER NOT NULL CHECK (version >= 1),
  -- What changed, in the firm's words: "Split into 3 phases, same total".
  change_summary TEXT NOT NULL,
  -- Why it changed, which is usually about the client: "They asked to drop
  -- phase 3 to fit the budget cycle." Optional — the change alone is a history.
  note TEXT,
  -- Integer cents. NULL where a version changed the shape and not the money.
  price_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ONE ROW PER VERSION PER QUOTE. A second v2 is a duplicate, not a revision:
-- revising a version means adding the next one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_versions_number
  ON quote_versions(quote_id, version);
