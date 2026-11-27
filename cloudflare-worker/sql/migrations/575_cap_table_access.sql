-- 575 — Cap table part 4: who sees what (D1019, #2856). Reserved by S21 in
-- D1015 §6.
--
-- GRANTS. One row per person (or cap table holder) and venture, at one of the
-- canvas's five levels (CT13): none, own_position, summary, investor, full.
-- Nothing is seen until the founder grants a level (D1015 §5, questions 3 and
-- 4). A grant names a user, a holder as the venture's cap table names them,
-- or both: `holder_ref` is what lets a holder see at least their own position.
-- `source` says whether the founder chose the level or it was prefilled from a
-- signed information-rights side letter (`source_ref` is its envelope uuid).
-- A changed level revokes the old row and inserts a new one, so the history of
-- who could see what stays on file; at most one row per person and venture is
-- live at a time.
--
-- THE ACCESS LOG. Who opened the cap table or a link, when, at which level,
-- and how (`via`). An admin's support read carries the reason the founder
-- sees. NO IP ADDRESS IS KEPT, and there is no column for one.
--
-- SHARE LINKS BY LEVEL. The existing links (migration 170) belong to one saved
-- scenario and one of three audiences. A venture link names the venture and a
-- level instead, and Investor and Full links record the founder's attestation
-- that the named holders agreed. Old links keep working until they expire.
--
-- Grep first (D689 D-t): `cap_table_access_grants`, `cap_table_access_log`
-- and the four `captable_share_tokens` columns exist in no earlier migration
-- and not in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS cap_table_access_grants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  user_id     INTEGER REFERENCES users(id),
  holder_ref  TEXT,
  level       TEXT    NOT NULL CHECK (level IN ('none', 'own_position', 'summary', 'investor', 'full')),
  source      TEXT    NOT NULL DEFAULT 'founder' CHECK (source IN ('founder', 'side_letter')),
  source_ref  TEXT,
  granted_by  INTEGER NOT NULL REFERENCES users(id),
  since       TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  revoked_by  INTEGER REFERENCES users(id),
  CHECK (user_id IS NOT NULL OR holder_ref IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_access_live_user
  ON cap_table_access_grants(project_id, user_id) WHERE revoked_at IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_access_live_holder
  ON cap_table_access_grants(project_id, holder_ref) WHERE revoked_at IS NULL AND user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cap_table_access_grants_user ON cap_table_access_grants(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS cap_table_access_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  user_id        INTEGER REFERENCES users(id),
  share_token_id INTEGER,
  via            TEXT    NOT NULL CHECK (via IN ('owner', 'member', 'grant', 'studio', 'support', 'hq', 'link')),
  level          TEXT    NOT NULL CHECK (level IN ('own_position', 'summary', 'investor', 'full')),
  reason         TEXT,
  opened_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cap_table_access_log_project ON cap_table_access_log(project_id, id);
CREATE INDEX IF NOT EXISTS idx_cap_table_access_log_opened ON cap_table_access_log(opened_at);

ALTER TABLE captable_share_tokens ADD COLUMN project_id INTEGER;
ALTER TABLE captable_share_tokens ADD COLUMN level TEXT;
ALTER TABLE captable_share_tokens ADD COLUMN holders_attested_at TEXT;
ALTER TABLE captable_share_tokens ADD COLUMN holders_attested_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_captable_share_tokens_project ON captable_share_tokens(project_id, created_at);
