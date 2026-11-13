-- 186 — the perk marketplace: catalog, partner submissions, claims, credits.
--
-- Migration 186. Applied by scripts/migrate-d1.mjs in numeric order and
-- ledgered in schema_migrations. Additive and idempotent; seeds no rows.
--
-- WHY A SECOND CREDIT LEDGER, when `intro_credit_ledger` (migration 150)
-- already exists and is well built. Two reasons, and the first is decisive:
--
--   1. THEY ARE NOT THE SAME UNIT. An intro credit buys exactly one warm
--      introduction. The perk canvas prices perks at 150–3,200 credits. If
--      both spent one pool, claiming a design-tooling perk would cost a
--      founder 3,200 warm introductions — an exchange rate nobody has set,
--      silently imposed by a shared column.
--   2. `intro_credit_ledger` constrains `bucket` and `kind` with CHECK
--      clauses. SQLite cannot alter a CHECK; extending them means rebuilding
--      a table that holds live production rows. An additive migration must
--      not do that.
--
-- So: a separate ledger, same proven shape. The intro ledger's design is
-- copied deliberately — append-only rows, balance derived by SUM(delta),
-- and a UNIQUE(user_id, kind, source_ref) that makes every grant and every
-- spend idempotent so a retry or a double-click cannot double-credit or
-- double-spend.
--
-- WHAT IS DELIBERATELY ABSENT: a monthly plan allowance. The canvas assumes
-- one ("400 credits come off your balance"), which requires deciding how many
-- credits a Growth or Studio subscription includes. That is a commercial term,
-- not an implementation detail, and inventing it here would put a made-up
-- price in the product. `grant` covers the operational case an admin can
-- honestly perform today; when an allowance is decided it is one more `kind`
-- with a 'month:YYYY-MM' source_ref, exactly as migration 150 does it.
--
-- MONEY. `price_cents` is an INTEGER number of cents (scripts/check-money-cents
-- .mjs enforces this). `credits` is a COUNT of credits, not currency, so it is
-- deliberately not named `*_cost` or `*_price` — those names would (correctly)
-- make the money guard demand cents of something that is not money.

-- One row per perk listing. Curated by an admin or submitted by a partner and
-- approved; nothing is visible to founders until `status = 'live'`.
CREATE TABLE IF NOT EXISTS perks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    uid            TEXT UNIQUE NOT NULL,
    -- The partner account that owns the listing. NULL for an admin-curated
    -- listing with no partner account behind it yet.
    partner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    partner_name   TEXT NOT NULL,
    category       TEXT NOT NULL,
    -- The headline, e.g. '3 months free business banking'.
    offer          TEXT NOT NULL,
    blurb          TEXT,
    -- The long-form terms shown in the claim drawer before anything is spent.
    detail         TEXT,
    -- How a claim is paid for:
    --   credits — debits `credits` from the caller's perk-credit balance
    --   tier    — included in a subscription tier; costs nothing, gated on it
    --   money   — a paid engagement; `price_cents` is quoted, invoiced offline
    kind           TEXT NOT NULL DEFAULT 'credits'
                   CHECK (kind IN ('credits', 'tier', 'money')),
    credits        INTEGER NOT NULL DEFAULT 0,
    -- Which tier includes it, when kind = 'tier'. Matches the ladder in
    -- middleware/requireTier.ts so the gate is the same one the rest of the
    -- product uses.
    required_tier  TEXT CHECK (required_tier IN ('free', 'growth', 'studio')),
    price_cents    INTEGER,
    -- What the founder receives on claim: a code, a link, or an introduction
    -- the partner follows up on.
    fulfilment     TEXT NOT NULL DEFAULT 'code'
                   CHECK (fulfilment IN ('code', 'link', 'intro')),
    -- Set only for 'link'. A 'code' perk's code is issued per claim below.
    redeem_url     TEXT,
    -- Total claims the partner will honour. NULL = uncapped.
    claim_cap      INTEGER,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'in_review', 'live', 'paused', 'rejected')),
    -- Why a submission was rejected, shown back to the submitting partner.
    review_note    TEXT,
    reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TEXT,
    featured       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_perks_status ON perks(status, featured, created_at);
CREATE INDEX IF NOT EXISTS idx_perks_partner ON perks(partner_user_id, status);

-- One row per (user, perk). The UNIQUE index is the double-claim guard at the
-- storage layer: a founder cannot spend twice on the same listing however many
-- times the button is pressed.
CREATE TABLE IF NOT EXISTS perk_claims (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT UNIQUE NOT NULL,
    perk_id      INTEGER NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Copied from the perk at claim time. A listing's price may change later;
    -- what this claim cost must not.
    credits_spent INTEGER NOT NULL DEFAULT 0,
    claimed_price_cents INTEGER,
    kind_at_claim TEXT NOT NULL DEFAULT 'credits',
    -- The issued redemption code, for fulfilment = 'code'.
    code         TEXT,
    -- Snapshot of the destination for 'link', so a later edit to the listing
    -- cannot silently redirect a claim already made.
    redeem_url   TEXT,
    status       TEXT NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
    expires_at   TEXT,
    redeemed_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_claims_once ON perk_claims(perk_id, user_id);
CREATE INDEX IF NOT EXISTS idx_perk_claims_user ON perk_claims(user_id, created_at);

-- Append-only. Balance is SUM(delta) and is never stored: a stored balance is
-- a second source of truth for a fact these rows already hold, and it drifts
-- the first time a write half-fails.
CREATE TABLE IF NOT EXISTS perk_credit_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- +N grant / −N spend.
    delta       INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund', 'admin_adjust')),
    -- Idempotency key payload: 'perk:<claim uid>' for a spend or refund,
    -- free-form for a grant or an adjustment.
    source_ref  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ledger_idem
    ON perk_credit_ledger(user_id, kind, source_ref);
CREATE INDEX IF NOT EXISTS idx_perk_ledger_user
    ON perk_credit_ledger(user_id, created_at);

-- Listing views, for the partner's own analytics. Deliberately coarse: one row
-- per (perk, viewer, day) so a page refresh does not inflate the number a
-- partner is shown.
CREATE TABLE IF NOT EXISTS perk_views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    perk_id    INTEGER NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_views_once ON perk_views(perk_id, user_id, day);
CREATE INDEX IF NOT EXISTS idx_perk_views_perk ON perk_views(perk_id, day);
