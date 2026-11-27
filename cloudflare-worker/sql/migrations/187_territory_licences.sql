-- 187 — the territory licence ledger.
--
-- Migration 187. Applied by scripts/migrate-d1.mjs in numeric order and
-- ledgered in schema_migrations. Additive and idempotent; seeds no rows.
--
-- WHAT THIS IS, AND WHAT IT IS NOT. Three rows of documentation/architecture/
-- ROUTE_MAP.md (Admin · Subsidiary, Support Security · Super, Support ·
-- Subsidiary) are marked "gated on the absent tenancy model". This is the
-- LEDGER half of that model: who holds a licence, over which territories, on
-- what terms, until when. It is NOT the scoping half — no existing query
-- learns a territory from this, and no row anywhere gains a licence_id.
--
-- That split is deliberate. Retrofitting territory scoping onto 151 route
-- files is a programme, and the repo's standing rule is that tenancy goes
-- through ONE middleware (services/tenancyScope.ts) rather than ad-hoc WHERE
-- clauses. A half-applied scope is worse than none: it reads as enforced and
-- is not. So the ledger lands first and stands alone, and everything derived
-- from account attribution — seats USED, accounts per licence, revenue per
-- subsidiary — reports as unavailable rather than as a plausible number.
--
-- THE ONE RULE THE SCHEMA ENFORCES BY ITSELF: two licences cannot hold the
-- same country. `licence_territories.country_code` is UNIQUE across the whole
-- table, not per licence. The canvas is explicit about why this belongs in
-- the picker rather than in review — "a conflict found after signature is an
-- amendment to two contracts, found here it is one click" — and a unique
-- index is the only version of that check which cannot be raced.
--
-- SUSPENSION DOES NOT RELEASE TERRITORY. A suspended licence still holds its
-- countries; releasing them is a termination, not a lapse. That falls out of
-- the design above for free: rows are deleted on terminate and left alone on
-- suspend, so a suspended holder keeps blocking the country and nobody has to
-- remember the rule.
--
-- MONEY AND RATES. `annual_fee_cents` is an INTEGER number of cents.
-- Revenue share and token split are stored as INTEGER BASIS POINTS
-- (3500 = 35%), not floats: the same exactness argument that makes cents
-- right for money makes bps right for a rate, and 0.35 is not representable
-- in binary floating point any more than $0.35 is.

CREATE TABLE IF NOT EXISTS territory_licences (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT UNIQUE NOT NULL,
    -- The human reference on the contract, in whatever form it uses there
    -- (the shape HQ has been using is <PREFIX>-<NNN>).
    licence_ref   TEXT UNIQUE NOT NULL,
    -- Step 1 of the issue flow. The subsidiary's legal entity, which already
    -- has a home: `entities` (schema.sql) carries entity_type 'subsidiary',
    -- a parent_id and a jurisdiction. No second entity model is invented here.
    entity_id     INTEGER REFERENCES entities(id) ON DELETE SET NULL,
    -- Denormalised so a licence still reads correctly if the entity row is
    -- later renamed or removed — a contract names a party as at signature.
    legal_entity_name TEXT NOT NULL,
    -- What the subsidiary is called inside the product, which is not always
    -- the legal name.
    brand_name    TEXT NOT NULL,
    registered_address TEXT,
    signatory_name  TEXT,
    signatory_title TEXT,

    --   draft              — being prepared; holds no territory yet
    --   pending_activation — terms agreed, blocked or awaiting the last step
    --   active             — trading
    --   suspended          — not trading, STILL HOLDS ITS TERRITORY
    --   terminated         — over; territory released
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'pending_activation', 'active', 'suspended', 'terminated')),

    term_years    INTEGER,
    annual_fee_cents INTEGER,
    -- ISO 4217. Licences are not all in one currency, and a bare integer of
    -- cents means nothing without it.
    currency      TEXT NOT NULL DEFAULT 'EUR',
    -- Basis points: 3500 = 35%. See the header.
    revenue_share_bps INTEGER,
    token_split_bps   INTEGER,

    starts_on     TEXT,
    renews_on     TEXT,
    suspended_at  TEXT,
    terminated_at TEXT,
    -- Why it was suspended or terminated. Shown wherever the status is.
    status_note   TEXT,

    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licences_status ON territory_licences(status, renews_on);

-- One row per country a licence holds. See the header: the UNIQUE index is on
-- country_code ALONE, across every licence, which is what makes two holders
-- of one country unrepresentable rather than merely discouraged.
CREATE TABLE IF NOT EXISTS licence_territories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    -- ISO 3166-1 alpha-2, upper case.
    country_code TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_territory_exclusive
    ON licence_territories(country_code);
CREATE INDEX IF NOT EXISTS idx_licence_territory_licence
    ON licence_territories(licence_id);

-- Step 3. Seats licensed, by the persona the seat is for. `seats_licensed` is
-- what the contract sold. Seats USED is not here, and cannot be: it needs
-- every account to carry a licence, which is the scoping half this migration
-- deliberately does not build.
CREATE TABLE IF NOT EXISTS licence_seats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    seat_type  TEXT NOT NULL
               CHECK (seat_type IN ('founder', 'investor', 'advisor', 'partner')),
    seats_licensed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_seats_once
    ON licence_seats(licence_id, seat_type);

-- Append-only. A licence's history is the sequence of things done to it, and
-- a contract dispute is exactly the case where an overwritten status is
-- useless. Nothing here is ever updated or deleted.
CREATE TABLE IF NOT EXISTS licence_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    event        TEXT NOT NULL
                 CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                  'terms_changed', 'activated', 'suspended',
                                  'reinstated', 'renewed', 'terminated')),
    -- JSON: whatever the event changed, before and after.
    detail_json  TEXT,
    note         TEXT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licence_events_licence
    ON licence_events(licence_id, created_at);
