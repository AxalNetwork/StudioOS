-- 461 — the stores behind Build's records and Add forms (D690 S18-B, #1693).
--
-- Every Build row opens one record (CO:369-374) and every Add opens a form
-- (CO:311-316). This adds a home for each field no store held; #1694 reads
-- them and #1695 writes them. Decision numbers are #1693's.
--
-- Grep first (D-t): no column below exists on its table in schema_baseline.sql
-- or in any earlier migration, and none of the six tables exists.
-- cycle_records_build_d690.test.ts holds that as an assertion.
--
--   mvp_features.description / scope (decisions 1 and 2)
--     Add feature's description, and Core or Out of scope. A NULL scope reads
--     from the MVP-scope tier of added_value (Low is Out of scope, High and
--     Medium are Core), so no row is rewritten. Impact and Effort stay in
--     added_value and effort. Not added to the lazy CREATE TABLE in
--     progress.ts: the ALTER would fail on a database the runtime made first.
--
--   venture_risks.feature_id (decision 1)
--     The feature a risk threatens. An older risk has none and stays in the
--     module's facts.
--
--   roadmap_okrs.feature_id / feedback_theme
--     The feature an item delivers and the feedback theme it answers.
--     Dependencies stay in okr_dependencies (254), with its cycle check.
--
--   formation_steps.kind / jurisdiction / for_holder_id (decision 8)
--     Add filing's kind (it has no title field), where it is filed, and the
--     founder an 83(b) is for. state and proof_file_key exist (441).
--
--   project_core_systems.feeds_json / sync_request / sync_request_by (decision 5)
--     What the founder says the system feeds (use_of_funds, kpis, team);
--     nothing reads data through it. sync_request holds Connect a system's
--     Sync choice until a connection is mapped, and sync_request_by the member
--     who made it; the connection's own integrations.config_json.sync_frequency
--     stays the one setting the scheduler honours.
--
--   mvp_test_sessions / mvp_test_findings
--     A must-have's test sessions, and what each found about a hypothesis.
--
--   mvp_feature_links (decision 7)
--     A Figma or GitHub URL attached to a feature. external_ref holds the
--     GitHub ledger key (issue:<owner>/<repo>#<n> or pull:...) when the URL
--     names one.
--
--   mvp_release_checks / founder_contributions / formation_step_checks
--     A must-have's release checklist, a founder's logged contributions, and
--     the done steps of a filing's checklist.
--
-- Not added, because the store exists: roadmap_dependencies (okr_dependencies),
-- project_core_systems.sync_frequency or any second sync setting (the
-- connection's sync_frequency), Impact (added_value), and filing state and
-- proof (441). No money is stored.
--
-- Additive: ADD COLUMN with a NULL default, and CREATE TABLE / INDEX IF NOT
-- EXISTS. No backfill: an older row genuinely has no value. No BEGIN/COMMIT.

ALTER TABLE mvp_features ADD COLUMN description TEXT;
ALTER TABLE mvp_features ADD COLUMN scope TEXT CHECK (scope IS NULL OR scope IN ('core', 'out'));

ALTER TABLE venture_risks ADD COLUMN feature_id INTEGER REFERENCES mvp_features(id) ON DELETE SET NULL;

ALTER TABLE roadmap_okrs ADD COLUMN feature_id INTEGER REFERENCES mvp_features(id) ON DELETE SET NULL;
ALTER TABLE roadmap_okrs ADD COLUMN feedback_theme TEXT;

ALTER TABLE formation_steps ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('formation', 'ein', '83b', 'annual_report', 'franchise_tax', 'other'));
ALTER TABLE formation_steps ADD COLUMN jurisdiction TEXT;
ALTER TABLE formation_steps ADD COLUMN for_holder_id INTEGER REFERENCES cap_table_holders(id) ON DELETE SET NULL;

ALTER TABLE project_core_systems ADD COLUMN feeds_json TEXT;
ALTER TABLE project_core_systems ADD COLUMN sync_request TEXT CHECK (sync_request IS NULL OR sync_request IN ('live', 'hourly', 'daily', 'manual'));
ALTER TABLE project_core_systems ADD COLUMN sync_request_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS mvp_test_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id    INTEGER NOT NULL REFERENCES mvp_features(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (length(trim(title)) > 0),
  held_on       TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mvp_test_findings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  session_id    INTEGER NOT NULL REFERENCES mvp_test_sessions(id) ON DELETE CASCADE,
  text          TEXT NOT NULL CHECK (length(trim(text)) > 0),
  hypothesis_id INTEGER REFERENCES hypotheses(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('supports', 'contradicts')),
  kept          INTEGER NOT NULL DEFAULT 1 CHECK (kept IN (0, 1)),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mvp_feature_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  feature_id   INTEGER NOT NULL REFERENCES mvp_features(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('figma', 'github')),
  url          TEXT NOT NULL,
  external_ref TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (feature_id, url)
);

CREATE TABLE IF NOT EXISTS mvp_release_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  feature_id INTEGER NOT NULL REFERENCES mvp_features(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (length(trim(label)) > 0),
  done_at    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS founder_contributions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  holder_id  INTEGER NOT NULL REFERENCES cap_table_holders(id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (length(trim(text)) > 0),
  on_date    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS formation_step_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  step_id    INTEGER NOT NULL REFERENCES formation_steps(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (step_id, key)
);

CREATE INDEX IF NOT EXISTS idx_venture_risks_feature ON venture_risks(feature_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_feature ON roadmap_okrs(project_id, feature_id);
CREATE INDEX IF NOT EXISTS idx_mvp_test_sessions_feature ON mvp_test_sessions(project_id, feature_id);
CREATE INDEX IF NOT EXISTS idx_mvp_test_findings_session ON mvp_test_findings(session_id);
CREATE INDEX IF NOT EXISTS idx_mvp_feature_links_feature ON mvp_feature_links(feature_id);
CREATE INDEX IF NOT EXISTS idx_mvp_release_checks_feature ON mvp_release_checks(feature_id);
CREATE INDEX IF NOT EXISTS idx_founder_contributions_holder ON founder_contributions(project_id, holder_id);
