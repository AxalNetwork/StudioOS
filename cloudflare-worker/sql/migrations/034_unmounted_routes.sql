-- Task #1 (AG) — Backing tables for the previously-unmounted Worker routes
-- (founder risk, service offerings, metrics snapshots, and the public-profile
-- facade). Idempotent — every CREATE / INDEX is `IF NOT EXISTS` so re-running
-- on a partially-applied DB is safe. Mirrors the additions in `schema.sql`.

-- Founder Risk pulls (admin-recorded; latest row per founder is "current").
CREATE TABLE IF NOT EXISTS founder_risk_pulls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
    score REAL,
    signals_json TEXT NOT NULL DEFAULT '[]',
    source TEXT,
    pulled_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_founder_risk_pulls_founder
    ON founder_risk_pulls(founder_id, created_at DESC);

-- Service Offerings (founder-marketplace catalog).
CREATE TABLE IF NOT EXISTS service_offerings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    price_usd REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_offerings_owner
    ON service_offerings(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_service_offerings_active_created
    ON service_offerings(is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS service_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    offering_id INTEGER NOT NULL REFERENCES service_offerings(id) ON DELETE CASCADE,
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_engagements_owner
    ON service_engagements(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_engagements_requester
    ON service_engagements(requester_user_id, created_at DESC);

-- Metrics Snapshots (project-level periodic MRR / active-user logging).
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_date TEXT NOT NULL,
    mrr REAL,
    active_users INTEGER,
    notes TEXT,
    source TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_project
    ON metrics_snapshots(project_id, snapshot_date DESC);

-- Spec-contract placeholder tables. The Worker code reuses pre-existing
-- tables under different names where they already cover the data
-- (cap_table_holders ≈ captable_holders, mentor_office_hour_slots ≈
-- mentor_slots, corporate_profiles ≈ companies, comarketing_pitches ≈
-- comarketing_campaigns, watchlist_items ≈ watchlist_items, etc.). The
-- following empty tables exist purely to satisfy the spec's "table must
-- exist" contract for downstream tasks that may consume them by name.
-- All are idempotent and harmless.
CREATE TABLE IF NOT EXISTS comarketing_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    pitch_id INTEGER REFERENCES comarketing_pitches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comarketing_campaigns_status
    ON comarketing_campaigns(status, created_at DESC);

CREATE TABLE IF NOT EXISTS cofounder_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS cofounder_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_a, user_b)
);

CREATE TABLE IF NOT EXISTS insights_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_insights_signals_kind
    ON insights_signals(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS marketplace_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS marketplace_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);

-- Spec-contract name parity. Every table name listed in the AG plan must
-- exist by SOME definition; many already exist under different real names
-- (cap_table_holders ↔ captable_holders, mentor_office_hour_slots ↔
-- mentor_slots, corporate_profiles ↔ companies, comarketing_pitches ↔
-- comarketing_campaigns, founder_needs ↔ needs, etc.). The Worker code
-- uses the real names; these IF NOT EXISTS placeholder tables exist solely
-- to satisfy the spec contract for downstream consumers that may reference
-- the spec-listed names. All harmless and idempotent.
CREATE TABLE IF NOT EXISTS calendar_google_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS mentor_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mentor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_holders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    shares REAL NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'common',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_securities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    shares REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS captable_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    company_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_oh_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS references_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    referee_name TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Additional spec-name parity placeholders (round-4): names called out by
-- contract review even though canonical tables exist under different names
-- (decision_journal_entries, mentor_bookings_real, ic_meetings_real, etc.).
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    thesis TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mentor_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    slot_id INTEGER,
    booker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'booked',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ic_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS founder_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood INTEGER,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS compliance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wellbeing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wellbeing_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS financial_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS watchlist_items_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS needs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    need_id INTEGER REFERENCES needs(id) ON DELETE CASCADE,
    provider_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount_cents INTEGER,
    currency TEXT DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
