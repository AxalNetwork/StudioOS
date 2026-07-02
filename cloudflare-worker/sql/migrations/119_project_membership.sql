-- Task #1 (Spin-Out Teams Collaboration) — project membership layer.
--
-- A Spin-Out project was single-founder via projects.founder_id. This adds an
-- ADDITIVE membership layer so a project can be built by a TEAM: co-founders
-- (full read+edit of project data) and advisors (read + advisory access). The
-- original founder_id owner is preserved and is mirrored as an `owner` member
-- row on first touch — we never ALTER projects.
--
-- Two tables:
--   project_members            — the materialized membership (one active row
--                                per (project_id, user_id); re-adding flips a
--                                removed row back to accepted).
--   project_member_invitations — the audit + acceptance funnel. Every add-path
--                                (user_id / email / link / cofounder_match)
--                                records an invitation; tokenized link/email
--                                invites stay `pending` until the invitee
--                                accepts (bound to the authed user).
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/119_project_membership.sql
--
-- The Worker also carries a lazy `ensureProjectMembershipSchema()` helper
-- (services/projectAccess.ts) that runs the same CREATE TABLE IF NOT EXISTS on
-- first hit, matching the recovery pattern documented in replit.md.

CREATE TABLE IF NOT EXISTS project_members (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id               INTEGER NOT NULL,
  user_id                  INTEGER NOT NULL,
  role                     TEXT NOT NULL DEFAULT 'cofounder',   -- owner | cofounder | advisor
  status                   TEXT NOT NULL DEFAULT 'accepted',    -- accepted | removed
  source                   TEXT,                                -- owner_seed | user_id | email | link | cofounder_match
  invitation_id            INTEGER,
  cofounder_connection_id  INTEGER,
  added_by_user_id         INTEGER,
  accepted_at              TEXT,
  removed_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_pair
  ON project_members (project_id, user_id);
CREATE INDEX IF NOT EXISTS ix_project_members_user
  ON project_members (user_id, status);
CREATE INDEX IF NOT EXISTS ix_project_members_project
  ON project_members (project_id, status);

CREATE TABLE IF NOT EXISTS project_member_invitations (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id               INTEGER NOT NULL,
  role                     TEXT NOT NULL DEFAULT 'cofounder',   -- cofounder | advisor
  status                   TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | revoked | expired
  source                   TEXT,                                -- user_id | email | link | cofounder_match
  invitee_user_id          INTEGER,
  invitee_email            TEXT,                                -- normalized (lowercased, trimmed)
  token_hash               TEXT,                                -- sha256 hex of the raw share token (link/email)
  cofounder_connection_id  INTEGER,
  invited_by_user_id       INTEGER,
  accepted_by_user_id      INTEGER,
  expires_at               TEXT,
  accepted_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pmi_token
  ON project_member_invitations (token_hash);
CREATE INDEX IF NOT EXISTS ix_pmi_project
  ON project_member_invitations (project_id, status);
CREATE INDEX IF NOT EXISTS ix_pmi_invitee_user
  ON project_member_invitations (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS ix_pmi_invitee_email
  ON project_member_invitations (invitee_email, status);
