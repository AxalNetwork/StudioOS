-- 188 — a real invoice for a marketplace engagement.
--
-- Migration 188. Applied by scripts/migrate-d1.mjs in numeric order and
-- ledgered in schema_migrations. Additive and idempotent; seeds no rows.
--
-- THE BUG THIS FIXES. `POST /api/engagements/:id/invoice` on the production
-- worker did this:
--
--     nextStatus = 'invoiced';
--     sets.push('invoice_id = ?'); params.push(`stub-${e.uid.slice(0, 8)}`);
--
-- and nothing else. There is no `stripe_invoice_url` column on D1's
-- `engagements`, the worker never writes one, and `engagementDto` is a bare
-- row passthrough — so `NeedsBoardPage.jsx:615` and `:721`, both of which
-- render the invoice link behind `{e.stripe_invoice_url && …}`, were
-- unconditionally falsy in production.
--
-- The result was a state that lies: a partner clicks Invoice, the engagement
-- is permanently marked `invoiced` with a `stub-` id, no invoice exists, no
-- link appears, and neither side has anything to send or pay. The FastAPI in
-- backend/ does create a real invoice — but that is Replit-dev-only and is
-- never deployed, which is exactly why ROUTE_MAP described behaviour nobody
-- in production has ever seen.
--
-- WHY A DOCUMENT RATHER THAN STRIPE. Task #138 deliberately removed the
-- Stripe Connect payouts backend; re-adding Connect to un-break this would
-- reverse a decision that was made on purpose. The canvas asks for an
-- in-platform invoice document — masthead, bill-to, engagement reference,
-- line items carried from the accepted quote, tax, totals — and every field
-- of that is derivable from rows D1 already holds. So the invoice is a real
-- artifact the platform issues itself, with no payment rail invented behind
-- it.
--
-- WHAT THIS DOES NOT DO. It does not collect money. `paid_at` records that a
-- partner says they were paid out-of-band; the platform is not a party to
-- that and must not imply it processed anything.
--
-- MONEY. Every amount here is an INTEGER of minor units. `quotes.price` and
-- `engagements.price` are legacy REAL dollars (on record in
-- scripts/money-cents-baseline.json), so the conversion happens once, at
-- issue, and the result is snapshotted — a later edit to the quote must not
-- change an invoice already issued.

CREATE TABLE IF NOT EXISTS engagement_invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    uid            TEXT UNIQUE NOT NULL,
    -- Human reference printed on the document, e.g. 'AX-2026-0007'.
    invoice_number TEXT UNIQUE NOT NULL,
    -- One invoice per engagement. The UNIQUE index is the double-issue guard:
    -- a retried request returns the existing invoice instead of minting a
    -- second number for the same work.
    engagement_id  INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,

    -- Both parties, snapshotted. An invoice names who billed whom on the day
    -- it was issued; a later rename must not rewrite history.
    partner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    founder_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    bill_from_name TEXT,
    bill_to_name   TEXT,

    -- JSON: [{ description, quantity, unit_amount_cents, amount_cents }],
    -- carried from the accepted quote's deliverables at issue time.
    line_items_json TEXT,

    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    -- Basis points, like every other rate in this schema: 2000 = 20% VAT.
    tax_rate_bps   INTEGER NOT NULL DEFAULT 0,
    tax_cents      INTEGER NOT NULL DEFAULT 0,
    total_cents    INTEGER NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',

    notes          TEXT,
    --   issued — sent, unpaid
    --   paid   — the partner recorded payment received OUT OF BAND
    --   void   — cancelled; a void invoice keeps its number, never reuses it
    status         TEXT NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'paid', 'void')),
    issued_at      TEXT NOT NULL DEFAULT (datetime('now')),
    due_at         TEXT,
    paid_at        TEXT,
    void_reason    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_invoice_once
    ON engagement_invoices(engagement_id);
CREATE INDEX IF NOT EXISTS idx_engagement_invoices_partner
    ON engagement_invoices(partner_user_id, status, issued_at);
CREATE INDEX IF NOT EXISTS idx_engagement_invoices_founder
    ON engagement_invoices(founder_user_id, status, issued_at);

-- The number sequence, one row per year. A counter in its own table rather
-- than MAX(invoice_number)+1 over the invoices: parsing a formatted string
-- back into an integer to increment it is how duplicate numbers happen, and
-- a voided invoice must not free its number for reuse.
CREATE TABLE IF NOT EXISTS invoice_number_seq (
    year       TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
);
