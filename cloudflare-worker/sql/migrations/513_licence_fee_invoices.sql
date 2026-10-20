-- 513 — licence_fee_invoices: HQ's annual licence-fee invoices to a territory
-- licensee (D802, #2238; part of D795, #2228).
--
-- One new table.
--
--   licence_fee_invoices  one row per invoice HQ issues for a licence's annual
--       fee. The amount and currency are copied from the ledger
--       (`territory_licences.annual_fee_cents`, `currency`) AT ISSUE and never
--       recomputed: a re-termed fee does not restate an invoice somebody has
--       already been sent.
--
--       THE PERIOD runs from an anniversary of the licence's `starts_on` to
--       the day before the next one; `period_label` is its two years, e.g.
--       "2026–27". A period holds one live invoice: the partial unique index
--       below refuses a second one while the first is not void, so two
--       concurrent issues cannot both land.
--
--       `paid_cents` is what an HQ operator recorded receiving (D.8, as on a
--       statement): nothing here reads a bank or Stripe. Written only by the
--       Super Admin with step-up (`/api/admin/licences/:uid/fee-invoices`),
--       and every issue, payment and void is audited.

CREATE TABLE IF NOT EXISTS licence_fee_invoices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT NOT NULL UNIQUE,
    licence_uid   TEXT NOT NULL,
    period_label  TEXT NOT NULL,
    period_start  TEXT NOT NULL,
    period_end    TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    currency      TEXT NOT NULL,
    issued_at     TEXT NOT NULL,
    due_at        TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued', 'paid', 'void')),
    paid_cents    INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
    paid_at       TEXT,
    paid_note     TEXT,
    void_reason   TEXT,
    issued_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_fee_invoices_live_period
    ON licence_fee_invoices(licence_uid, period_start) WHERE status <> 'void';

CREATE INDEX IF NOT EXISTS idx_licence_fee_invoices_licence
    ON licence_fee_invoices(licence_uid, period_start DESC);
