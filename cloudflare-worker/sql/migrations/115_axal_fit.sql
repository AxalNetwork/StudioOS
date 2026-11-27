-- Migration 115 — Axal Fit: behavioral values, per-persona fit scores,
-- consultation bookings, and persisted admin best-fit reports (Task #19).
--
-- Backs the Conversational Profiling + Best-Fit Matching feature. The 5 Axal
-- behavioral values (integrity/stewardship/curiosity/resilience/collaboration)
-- are a NEW layer feeding the admin scorecard; the existing 15 value dimensions
-- (user_values) keep powering the user-facing "where you lean" graph.
--
-- services/axalFit.ts computes a 0..100 fit score per persona from a weighted
-- rubric (Σ weight×score/5 over answered categories). `axal_fit_scores` is an
-- append-only history; the latest row per (user_id, persona) is the current
-- score. Reports are precomputed on consultation booking + on admin fetch.
--
-- Idempotent (IF NOT EXISTS). Mirrored into schema.sql. D1 is canonical; the
-- dev FastAPI on SQLite is never deployed. References are documentation-only
-- (no PRAGMA foreign_keys), matching house style.

-- The 5 Axal behavioral values, one row per (user, value). Mirrors the shape of
-- user_values: score + confidence are 0..1 normalized (raw 0..5 ÷ 5).
CREATE TABLE IF NOT EXISTS axal_values (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value_key  TEXT NOT NULL,            -- integrity|stewardship|curiosity|resilience|collaboration
    score      REAL NOT NULL DEFAULT 0,  -- 0..1 normalized behavioral score
    confidence REAL NOT NULL DEFAULT 0,  -- 0..1 coverage/confidence
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, value_key)
);
CREATE INDEX IF NOT EXISTS idx_axal_values_user ON axal_values (user_id, updated_at);

-- Per-persona weighted-rubric result. Append-only; latest row per
-- (user_id, persona) by computed_at is the current fit.
CREATE TABLE IF NOT EXISTS axal_fit_scores (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona        TEXT NOT NULL,           -- founder|investor|partner|mentor|coach
    total_score    REAL NOT NULL DEFAULT 0, -- 0..100
    band           TEXT NOT NULL,           -- strong_yes|yes_caution|hold|no
    rubric_json    TEXT,                    -- {category:{score,weight,answered}}
    red_flags_json TEXT,                    -- JSON array of red-flag keys
    signal_quality REAL NOT NULL DEFAULT 0, -- 0..1 (0.6×coverage + 0.4×mean confidence)
    narrative_fit  TEXT,
    computed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_scores_latest
    ON axal_fit_scores (user_id, persona, computed_at);

-- Persisted admin best-fit report snapshots. Precomputed on consultation
-- booking + on admin fetch so the report is ready regardless of paywall.
CREATE TABLE IF NOT EXISTS axal_fit_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- report subject
    persona     TEXT,                                                     -- subject's primary persona at compute time
    report_json TEXT NOT NULL,
    computed_by INTEGER REFERENCES users(id),                             -- admin who triggered, NULL = system
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_axal_fit_reports_user ON axal_fit_reports (user_id, created_at);

-- Consultation requests ("Book with Guillaume"). Booking precomputes + stores a
-- best-fit report (report_id) so the admin has it ready.
CREATE TABLE IF NOT EXISTS admin_consultation_bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the requester (report subject)
    admin_id     INTEGER REFERENCES users(id),                             -- assigned admin (Guillaume), NULL until triaged
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    slot_at      TEXT,                                                     -- requested / confirmed slot
    status       TEXT NOT NULL DEFAULT 'requested',                        -- requested|confirmed|completed|cancelled
    topic        TEXT,
    notes        TEXT,
    report_id    INTEGER REFERENCES axal_fit_reports(id),                  -- precomputed snapshot
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_user   ON admin_consultation_bookings (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_status ON admin_consultation_bookings (status, requested_at);
