-- Axal Fit — conversational profiling methodology layer.
--
-- Adds the weighted per-persona "fit scorecard" (founder / partner / mentor-coach
-- / investor), the 5 Axal behavioral values (Integrity, Stewardship, Curiosity,
-- Resilience, Collaboration), the admin best-fit report snapshot, and admin
-- consultation bookings. Skills (user_skills, 8 axes) and the 15 value
-- dimensions (user_values) are reused as-is for the user-facing graphs; these
-- tables layer the admin scorecard + decision rule on top.
--
-- Idempotent (CREATE ... IF NOT EXISTS). Mirrored into schema.sql.

-- One row per (scored fit question × measure) answered in the advisor
-- conversation. A single question can measure several things at once — a rubric
-- category, an 8-axis skill, a 15-dim value lean, one of the 5 Axal values —
-- so it fans out into multiple rows here. The dashboard graphs and the admin
-- scorecard are all computed by aggregating this one table, keeping a single
-- source of truth. Latest answer per (user, question, measure) wins (upsert).
--   measure_kind: rubric | skill | value | axal_value
--   measure_key:  rubric category key / skill axis / value dim / axal value key
--   score:        0..5 (rubric/skill/axal_value) or −2..+2 (value lean)
CREATE TABLE IF NOT EXISTS axal_fit_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona TEXT NOT NULL,              -- founder|investor|partner|mentor|coach
    question_id TEXT NOT NULL,
    measure_kind TEXT NOT NULL,
    measure_key TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    red_flag TEXT,                      -- optional red-flag key if this probe tripped
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, question_id, measure_kind, measure_key)
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_responses_user
    ON axal_fit_responses(user_id, persona);
CREATE INDEX IF NOT EXISTS idx_axal_fit_responses_measure
    ON axal_fit_responses(user_id, measure_kind);

-- Computed weighted-rubric result; latest row per (user, persona) is current.
CREATE TABLE IF NOT EXISTS axal_fit_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona TEXT NOT NULL,
    total_score REAL NOT NULL DEFAULT 0,   -- 0..100
    band TEXT NOT NULL DEFAULT 'hold',     -- strong_yes|yes_caution|hold|no
    rubric_json TEXT NOT NULL DEFAULT '[]',-- per-category breakdown
    red_flags_json TEXT NOT NULL DEFAULT '[]',
    signal_quality REAL NOT NULL DEFAULT 0,-- 0..1 coverage/confidence
    narrative_fit TEXT,
    computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_scores_user
    ON axal_fit_scores(user_id, persona, computed_at DESC);

-- Persisted admin best-fit report snapshots (assembled on consultation booking).
CREATE TABLE IF NOT EXISTS axal_fit_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona TEXT,
    report_json TEXT NOT NULL DEFAULT '{}',
    computed_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_reports_user
    ON axal_fit_reports(user_id, created_at DESC);

-- User-requested consultations with the admin (Guillaume). Mirrors the
-- mentor_bookings pattern. On confirm, the best-fit report is precomputed.
CREATE TABLE IF NOT EXISTS admin_consultation_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id INTEGER REFERENCES users(id),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    slot_at TEXT,
    status TEXT NOT NULL DEFAULT 'requested', -- requested|confirmed|completed|declined|cancelled
    topic TEXT,
    notes TEXT,
    report_id INTEGER REFERENCES axal_fit_reports(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_consultation_bookings_status
    ON admin_consultation_bookings(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_consultation_bookings_user
    ON admin_consultation_bookings(user_id, created_at DESC);
