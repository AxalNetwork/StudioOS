-- Network Introductions — curated warm-intro propositions + credit ledger.
-- Migration 150. Applied automatically by scripts/migrate-d1.mjs (numeric order,
-- ledgered in schema_migrations). Additive + idempotent; seeds no rows.
--
-- Distinct from the investor-only `investor_introductions` quarterly quota
-- (routes/introductions.ts, Task #6 W-1): that surface is an investor→founder
-- REQUEST pipe. This one is the relationship-native "Introductions" feature
-- under Network for EVERY user type — the platform proposes warm intros
-- (matched on shared values / complementary skills / archetypes / jurisdiction
-- / specialization) and the user accepts (spending one credit) or declines
-- (free). Mirrored by ensureIntroNetworkSchema() in services/introductions.ts
-- so dev/preview D1s self-heal before this file lands.
--
--   intro_propositions   → one row per (receiving user, proposed counterpart)
--   intro_credit_ledger  → append-only ±credits, bucketed by origin
--
-- Credit buckets (business rule: tracked separately, no double counting):
--   allowance  — monthly plan allowance, granted lazily once per month
--                (source_ref 'month:YYYY-MM'); does NOT roll over — balance
--                math only counts allowance rows from the current month.
--   purchased  — Stripe intro-credit packs (source_ref 'pi:<payment_intent>').
--   referral   — +1 per valid referred signup (source_ref 'referral:<id>').
-- UNIQUE(user_id, kind, source_ref) makes every grant and every spend
-- idempotent: a webhook retry, double-click, or concurrent accept can never
-- double-credit or double-spend.

CREATE TABLE IF NOT EXISTS intro_propositions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    uid              TEXT UNIQUE NOT NULL,
    -- The user RECEIVING the proposition (owns the accept/decline decision).
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The counterpart being proposed.
    target_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    -- Composite 0..100 match score at generation time.
    score            REAL NOT NULL DEFAULT 0,
    -- JSON: { reasons[], shared_values[], complementary_skills[], archetypes{},
    --         jurisdiction{}, specializations[], relationship_context, components{} }
    breakdown_json   TEXT,
    -- 'matching' (engine-generated) | 'reciprocal' (mirror of the counterpart's
    -- row) | 'admin' (hand-curated).
    source           TEXT NOT NULL DEFAULT 'matching',
    expires_at       TEXT,
    responded_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One live proposition per (receiver, counterpart) pair — duplicate-acceptance
-- guard at the storage layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_props_pair
    ON intro_propositions(user_id, target_user_id);
CREATE INDEX IF NOT EXISTS idx_intro_props_user_status
    ON intro_propositions(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS intro_credit_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- +N grant / -1 spend.
    delta       INTEGER NOT NULL,
    bucket      TEXT NOT NULL CHECK (bucket IN ('allowance', 'purchased', 'referral')),
    kind        TEXT NOT NULL CHECK (kind IN
                ('monthly_grant', 'purchase', 'referral_reward', 'spend', 'admin_adjust')),
    -- Idempotency key payload: 'month:YYYY-MM' | 'pi:<id>' | 'referral:<id>'
    -- | 'intro:<proposition uid>' | free-form for admin_adjust.
    source_ref  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_ledger_idem
    ON intro_credit_ledger(user_id, kind, source_ref);
CREATE INDEX IF NOT EXISTS idx_intro_ledger_user
    ON intro_credit_ledger(user_id, created_at);
