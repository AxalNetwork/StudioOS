-- Task #8 (DI) — Founder Wellbeing fix + expert directory.
--
-- All CREATEs are IF NOT EXISTS so this file is safely re-runnable. It is
-- ALSO mirrored by ensureWellbeingExpertSchema() in routes/wellbeing.ts as a
-- self-healing fallback so the route works on D1 instances where this
-- migration hasn't been applied yet.
--
-- NB: never wrap in BEGIN/COMMIT — D1 raw SQL rejects nested transactions.

-- Bootstrap the legacy weekly check-in tables in case 034_unmounted_routes
-- was never applied to this D1 (it wasn't, in prod — see replit.md gotcha).
CREATE TABLE IF NOT EXISTS wellbeing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_anchor TEXT NOT NULL,
    stress_enc TEXT NOT NULL,
    sleep_enc TEXT NOT NULL,
    support_enc TEXT NOT NULL,
    decisions_enc TEXT NOT NULL,
    energy_enc TEXT NOT NULL,
    notes_enc TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, week_anchor)
);

CREATE TABLE IF NOT EXISTS wellbeing_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    region TEXT,
    is_24_7 INTEGER NOT NULL DEFAULT 0,
    is_free INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(category, name)
);

-- New: lightweight daily pulse (mood/stress/sleep/energy/focus/social) so
-- the page can render a 30-day chart. Free-text + tags are encrypted.
CREATE TABLE IF NOT EXISTS wellbeing_daily_pulses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    mood INTEGER,
    stress INTEGER,
    sleep INTEGER,
    energy INTEGER,
    focus INTEGER,
    social INTEGER,
    free_text_enc TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_wellbeing_daily_user_day ON wellbeing_daily_pulses(user_id, day DESC);

-- Expert directory.
CREATE TABLE IF NOT EXISTS experts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    headline TEXT,
    bio TEXT,
    photo_url TEXT,
    categories_json TEXT NOT NULL DEFAULT '[]',
    sectors_json TEXT NOT NULL DEFAULT '[]',
    languages_json TEXT NOT NULL DEFAULT '["en"]',
    timezones_json TEXT NOT NULL DEFAULT '[]',
    modalities_json TEXT NOT NULL DEFAULT '["video"]',
    pricing_model TEXT NOT NULL DEFAULT 'paid',
    hourly_rate_usd INTEGER,
    first_session_free INTEGER NOT NULL DEFAULT 0,
    calendly_url TEXT,
    booking_url TEXT,
    website_url TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_experts_active ON experts(is_active);

CREATE TABLE IF NOT EXISTS expert_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    review TEXT,
    category_match_pct INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(expert_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_expert_ratings_expert ON expert_ratings(expert_id);

CREATE TABLE IF NOT EXISTS expert_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_at TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'requested',
    booking_external_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_bookings_user ON expert_bookings(user_id, created_at DESC);

-- Free-tier gate: count distinct experts a user has "viewed" this month.
CREATE TABLE IF NOT EXISTS expert_profile_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_views_user_time ON expert_profile_views(user_id, viewed_at DESC);
