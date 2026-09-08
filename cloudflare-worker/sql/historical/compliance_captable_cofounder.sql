-- T12 — Compliance + Cap-table + Cofounder port from FastAPI to D1.
-- Apply via:
--   npx wrangler d1 execute studioos-db --config ../wrangler.toml --remote \
--     --file=cloudflare-worker/sql/compliance_captable_cofounder.sql
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS).

-- ---------- compliance_events (Task #32) ----------
-- Recurring deadlines auto-seeded by the incorporation wizard plus
-- manual additions from the /compliance page. Unique on
-- (project_id, event_type, due_date) so the seeder + the recurrence
-- roll-forward are idempotent.
CREATE TABLE IF NOT EXISTS compliance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    entity_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT NOT NULL,
    event_type TEXT NOT NULL,            -- annual_report | franchise_tax | registered_agent | board_meeting | other
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT NOT NULL,              -- ISO 'YYYY-MM-DD'
    completion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (completion_status IN ('pending', 'completed', 'snoozed')),
    completed_at TEXT,
    completed_by_user_id INTEGER REFERENCES users(id),
    recurrence TEXT NOT NULL DEFAULT 'annual',  -- annual | quarterly | monthly | one_time
    source TEXT NOT NULL DEFAULT 'auto',         -- auto | manual
    reminders_sent_json TEXT NOT NULL DEFAULT '[]',
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, event_type, due_date)
);
CREATE INDEX IF NOT EXISTS idx_compliance_project ON compliance_events(project_id, due_date);
CREATE INDEX IF NOT EXISTS idx_compliance_status  ON compliance_events(completion_status, due_date);

-- ---------- cap_table_scenarios (Task #27) ----------
CREATE TABLE IF NOT EXISTS cap_table_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    name TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    result_json TEXT,
    computed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_captable_owner   ON cap_table_scenarios(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_captable_project ON cap_table_scenarios(project_id);

-- ---------- cofounder_profiles (Task #38) ----------
CREATE TABLE IF NOT EXISTS cofounder_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    skills_json TEXT NOT NULL DEFAULT '[]',
    sectors_json TEXT NOT NULL DEFAULT '[]',
    commitment TEXT NOT NULL DEFAULT 'full_time',  -- full_time | part_time | exploring
    location_city TEXT,
    location_country TEXT,
    remote_ok INTEGER NOT NULL DEFAULT 1,
    equity_expectation_min REAL,
    equity_expectation_max REAL,
    bio TEXT,
    looking_for TEXT,
    listed INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cofounder_profile_listed ON cofounder_profiles(listed);

-- ---------- cofounder_interests ----------
CREATE TABLE IF NOT EXISTS cofounder_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT,
    status TEXT NOT NULL DEFAULT 'sent',  -- sent | withdrawn
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (from_user_id, to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_cofounder_interest_to   ON cofounder_interests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_cofounder_interest_from ON cofounder_interests(from_user_id, status);

-- ---------- cofounder_connections ----------
-- (user_a_id, user_b_id) is stored sorted ascending so a single UNIQUE
-- constraint catches the unordered pair on either side of insert races.
CREATE TABLE IF NOT EXISTS cofounder_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    user_a_id INTEGER NOT NULL REFERENCES users(id),
    user_b_id INTEGER NOT NULL REFERENCES users(id),
    nda_doc_a_id INTEGER REFERENCES documents(id),
    nda_doc_b_id INTEGER REFERENCES documents(id),
    nda_signed_at_a TEXT,
    nda_signed_at_b TEXT,
    nda_signed_ip_a TEXT,
    nda_signed_ip_b TEXT,
    nda_signed_name_a TEXT,
    nda_signed_name_b TEXT,
    status TEXT NOT NULL DEFAULT 'pending_nda',  -- pending_nda | active | closed
    closed_at TEXT,
    closed_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_cofounder_conn_a ON cofounder_connections(user_a_id);
CREATE INDEX IF NOT EXISTS idx_cofounder_conn_b ON cofounder_connections(user_b_id);
