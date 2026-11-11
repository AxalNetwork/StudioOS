-- D5299 (#5299, slice 1 of 6 of #5038) — the revenue ledger: `financial_events`.
--
-- WHAT THIS IS. One append-only row per financial event the platform learns of:
-- a paid invoice, a succeeded charge or PaymentIntent, a refund, a dispute
-- opened or closed, or an HQ adjustment. Revenue reads these rows instead of
-- walking Stripe customers on page load (later slices of #5038). Written only
-- by `services/financialEvents.ts`.
--
-- IDEMPOTENCY. `(source, source_event_id)` is UNIQUE: a Stripe event id, or
-- the object id of an HQ action (the refund `re_…` HQ's refund route issued).
-- A replay meets the index and writes nothing. A refund is also keyed by
-- `refund_key` = `<charge id>:<cumulative refunded, Stripe units>`, which both
-- HQ's refund route and Stripe's `charge.refunded` can compute, so a refund HQ
-- issued and Stripe then reports is one row, whichever lands first.
--
-- AMOUNTS. Integer minor units of the row's own `currency` (ISO 4217, upper
-- case; ISK and UGX converted from Stripe's hundredths, D5029). Each row
-- carries what that event moved: `gross_cents` money collected, `refund_cents`
-- money returned or withdrawn (a refund, a dispute's withdrawal),
-- `net_cents` = gross - refund. An amount the event did not let us read is
-- NULL, never 0; a row with no currency carries no amount. Rows of different
-- currencies are never summed: there is no FX policy.
--
-- ATTRIBUTION. `user_id`, `company_id`, `project_id`, `licence_uid`,
-- `revenue_stream` and `product_ref` are stamped once, at write time, from
-- what the event itself names. One that cannot be resolved is NULL and read as
-- unattributed; nothing is guessed and nothing fills it in later. No foreign
-- keys, on purpose: an ON DELETE action would rewrite a ledger row.
--
-- IMMUTABLE. Rows are never deleted, and never updated except their
-- reconciliation (`reconciliation_state`, `reconciled_at`,
-- `reconciled_by_user_id`, `reconciliation_note`), which only
-- `setReconciliationState` writes. The triggers below refuse anything else.
--
-- COVERAGE. `financial_event_coverage` names each source and the moment the
-- ledger began recording it. Nothing before that is backfilled; later slices
-- show the gap before `coverage_starts_at` rather than reading it as zero. An
-- insert from a source with no coverage row is refused.
--
-- New tables, re-runnable. No BEGIN/COMMIT: D1 rejects transaction control in a
-- migration file (#26).

CREATE TABLE IF NOT EXISTS financial_event_coverage (
  source             TEXT PRIMARY KEY CHECK (length(source) BETWEEN 1 AND 40 AND source NOT GLOB '*[^a-z_]*'),
  coverage_starts_at TEXT NOT NULL,
  note               TEXT
);

INSERT OR IGNORE INTO financial_event_coverage (source, coverage_starts_at, note)
VALUES ('stripe', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'Stripe webhook events from this migration on; no backfill (D5299).'),
       ('hq', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'HQ billing actions (the refund route) from this migration on; no backfill (D5299).');

CREATE TRIGGER IF NOT EXISTS trg_financial_event_coverage_kept
BEFORE DELETE ON financial_event_coverage
BEGIN
  SELECT RAISE(ABORT, 'financial_event_coverage rows are kept');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_event_coverage_immutable
BEFORE UPDATE ON financial_event_coverage
BEGIN
  SELECT RAISE(ABORT, 'financial_event_coverage rows are immutable');
END;

CREATE TABLE IF NOT EXISTS financial_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  source                TEXT NOT NULL,
  source_event_id       TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 255),
  source_event_type     TEXT NOT NULL CHECK (length(source_event_type) BETWEEN 1 AND 80),
  kind                  TEXT NOT NULL CHECK (kind IN ('invoice', 'charge', 'payment', 'refund', 'dispute', 'adjustment')),
  livemode              INTEGER CHECK (livemode IN (0, 1)),
  object_ref            TEXT,
  charge_ref            TEXT,
  payment_intent_ref    TEXT,
  invoice_ref           TEXT,
  customer_ref          TEXT,
  refund_key            TEXT,
  user_id               INTEGER,
  company_id            INTEGER,
  project_id            INTEGER,
  licence_uid           TEXT,
  revenue_stream        TEXT,
  product_ref           TEXT,
  actor_user_id         INTEGER,
  currency              TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  gross_cents           INTEGER CHECK (gross_cents IS NULL OR gross_cents >= 0),
  refund_cents          INTEGER CHECK (refund_cents IS NULL OR refund_cents >= 0),
  net_cents             INTEGER,
  occurred_at           TEXT,
  recorded_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  reconciliation_state  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (reconciliation_state IN ('pending', 'matched', 'discrepancy', 'excluded')),
  reconciled_at         TEXT,
  reconciled_by_user_id INTEGER,
  reconciliation_note   TEXT,
  UNIQUE (source, source_event_id),
  CHECK (currency IS NOT NULL OR (gross_cents IS NULL AND refund_cents IS NULL AND net_cents IS NULL)),
  CHECK (net_cents IS NULL OR (gross_cents IS NOT NULL AND refund_cents IS NOT NULL AND net_cents = gross_cents - refund_cents))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_events_refund_key
  ON financial_events (refund_key) WHERE refund_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_events_occurred
  ON financial_events (currency, kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_financial_events_user
  ON financial_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_financial_events_reconciliation
  ON financial_events (reconciliation_state, id);

CREATE TRIGGER IF NOT EXISTS trg_financial_events_source_covered
BEFORE INSERT ON financial_events
WHEN NOT EXISTS (SELECT 1 FROM financial_event_coverage WHERE source = NEW.source)
BEGIN
  SELECT RAISE(ABORT, 'financial_events source has no coverage row');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_events_kept
BEFORE DELETE ON financial_events
BEGIN
  SELECT RAISE(ABORT, 'financial_events rows are kept');
END;

CREATE TRIGGER IF NOT EXISTS trg_financial_events_immutable
BEFORE UPDATE ON financial_events
WHEN NEW.id IS NOT OLD.id OR NEW.uid IS NOT OLD.uid OR NEW.source IS NOT OLD.source
  OR NEW.source_event_id IS NOT OLD.source_event_id OR NEW.source_event_type IS NOT OLD.source_event_type
  OR NEW.kind IS NOT OLD.kind OR NEW.livemode IS NOT OLD.livemode OR NEW.object_ref IS NOT OLD.object_ref
  OR NEW.charge_ref IS NOT OLD.charge_ref OR NEW.payment_intent_ref IS NOT OLD.payment_intent_ref
  OR NEW.invoice_ref IS NOT OLD.invoice_ref OR NEW.customer_ref IS NOT OLD.customer_ref
  OR NEW.refund_key IS NOT OLD.refund_key OR NEW.user_id IS NOT OLD.user_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.licence_uid IS NOT OLD.licence_uid
  OR NEW.revenue_stream IS NOT OLD.revenue_stream OR NEW.product_ref IS NOT OLD.product_ref
  OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.currency IS NOT OLD.currency
  OR NEW.gross_cents IS NOT OLD.gross_cents OR NEW.refund_cents IS NOT OLD.refund_cents
  OR NEW.net_cents IS NOT OLD.net_cents OR NEW.occurred_at IS NOT OLD.occurred_at
  OR NEW.recorded_at IS NOT OLD.recorded_at
BEGIN
  SELECT RAISE(ABORT, 'financial_events rows are immutable; only the reconciliation state moves');
END;
