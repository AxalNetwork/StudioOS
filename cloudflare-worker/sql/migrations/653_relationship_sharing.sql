-- 653 — the team relationship layer (D1356, #3571; part 7 of #3564).
--
-- Identity, provenance and access stay apart:
--   * IDENTITY: `shared_relationships.person_key` — the exact profile URL, else
--     the exact email, never a name — computed on the shared projection only.
--     A member's own book (`network_connections`) is never rewritten.
--   * PROVENANCE: `contact_sources` (D1350) says which source vouches for a row.
--   * ACCESS: `relationship_shares` — private by default; a member opts in.
--
-- `team_memberships` is a VIEW over the memberships Axal already records, so
-- nobody maintains it by hand and it cannot drift (#3564 Q2 = B):
--   * a venture: its founder and its accepted owner or co-founder members
--     (`project_members`); an advisor is not the venture's team;
--   * an investor firm: the primary investor account and its accepted,
--     unrevoked seats (`investor_seats`, D632);
--   * Axal HQ: active admins.
-- A fund has no membership table (`vc_funds` names one GP and one fund admin),
-- so funds are left out until one exists.
--
-- `shared_relationships` is the projection a teammate may ever see: name,
-- company, title, connected-on and the vouching source. It has no email,
-- phone, notes or URL column. A row is in it only when an eligible source
-- vouches for it: the member's own `Connections.csv`, a spreadsheet, or a row
-- they typed (a row with no source row is theirs, typed before D1350). API
-- rows (`linkedin_api`, `linkedin_dma`) are not eligible until part 5's
-- data-use flags (#3569) say so.
--
-- Additive: CREATE ... IF NOT EXISTS.

CREATE VIEW IF NOT EXISTS team_memberships AS
  SELECT 'project:' || p.id AS team_key, u.id AS user_id, 'venture' AS team_kind, p.name AS team_label
    FROM projects p JOIN users u ON u.founder_id = p.founder_id AND u.role = 'founder'
   WHERE p.deleted_at IS NULL AND p.founder_id IS NOT NULL AND u.is_active = 1
  UNION
  SELECT 'project:' || p.id, pm.user_id, 'venture', p.name
    FROM project_members pm JOIN projects p ON p.id = pm.project_id JOIN users u ON u.id = pm.user_id
   WHERE pm.status = 'accepted' AND pm.removed_at IS NULL AND pm.role IN ('owner', 'cofounder')
     AND p.deleted_at IS NULL AND u.is_active = 1
  UNION
  SELECT 'firm:' || u.id, u.id, 'firm', COALESCE(NULLIF(TRIM(u.name), ''), 'Investor firm')
    FROM users u
   WHERE u.role = 'investor' AND u.is_active = 1 AND u.investor_seat_primary_user_id IS NULL
  UNION
  SELECT 'firm:' || s.primary_user_id, s.seat_user_id, 'firm', COALESCE(NULLIF(TRIM(p.name), ''), 'Investor firm')
    FROM investor_seats s JOIN users p ON p.id = s.primary_user_id JOIN users u ON u.id = s.seat_user_id
   WHERE s.accepted_at IS NOT NULL AND s.revoked_at IS NULL AND p.role = 'investor' AND p.is_active = 1
     AND u.is_active = 1 AND u.investor_seat_primary_user_id = s.primary_user_id
  UNION
  SELECT 'hq', u.id, 'hq', 'Axal HQ' FROM users u WHERE u.role = 'admin' AND u.is_active = 1;

-- One opt-in per member: team_key '*' covers every team they belong to; a row
-- for one team turns it on or off there alone (#3564 Q3 = A). Withdrawing sets
-- `withdrawn_at`, and every read checks it, so it takes effect on the next read.
CREATE TABLE IF NOT EXISTS relationship_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'existence' CHECK (scope IN ('existence')),
  granted_at TEXT,
  withdrawn_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, team_key)
);
CREATE INDEX IF NOT EXISTS idx_relationship_shares_team ON relationship_shares(team_key, user_id);

CREATE VIEW IF NOT EXISTS shared_relationships AS
  SELECT nc.id AS contact_id, nc.user_id AS owner_user_id,
         CASE WHEN nc.linkedin_url IS NOT NULL AND TRIM(nc.linkedin_url) <> '' THEN 'url:' || lower(TRIM(nc.linkedin_url))
              WHEN nc.email IS NOT NULL AND TRIM(nc.email) <> '' THEN 'email:' || lower(TRIM(nc.email))
              ELSE NULL END AS person_key,
         CASE WHEN nc.linkedin_url IS NOT NULL AND TRIM(nc.linkedin_url) <> '' THEN 'url:' || lower(TRIM(nc.linkedin_url)) END AS url_key,
         CASE WHEN nc.email IS NOT NULL AND TRIM(nc.email) <> '' THEN 'email:' || lower(TRIM(nc.email)) END AS email_key,
         nc.name AS name, nc.company AS company, nc.title AS title, nc.connected_on AS connected_on,
         COALESCE((SELECT cs.source FROM contact_sources cs
                    WHERE cs.contact_table = 'network_connections' AND cs.contact_id = nc.id AND cs.owner_user_id = nc.user_id
                      AND cs.source IN ('linkedin_csv', 'csv', 'typed')
                    ORDER BY cs.id LIMIT 1), 'typed') AS source
    FROM network_connections nc
   WHERE EXISTS (SELECT 1 FROM contact_sources cs
                  WHERE cs.contact_table = 'network_connections' AND cs.contact_id = nc.id AND cs.owner_user_id = nc.user_id
                    AND cs.source IN ('linkedin_csv', 'csv', 'typed'))
      OR NOT EXISTS (SELECT 1 FROM contact_sources cs
                  WHERE cs.contact_table = 'network_connections' AND cs.contact_id = nc.id);

-- Introductions asked, made and declined; meetings; outcomes. Linked to an
-- `investor_introductions` or `intro_propositions` row where one exists.
-- `person_key` and the name are copied at the ask, so a later withdrawal
-- hides nothing the asker was already shown, and reveals nothing more.
CREATE TABLE IF NOT EXISTS relationship_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('intro_requested', 'intro_made', 'intro_declined', 'meeting', 'outcome')),
  requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teammate_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_key TEXT NOT NULL,
  contact_id INTEGER,
  person_key TEXT,
  person_name TEXT NOT NULL,
  person_company TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'made', 'declined', 'withdrawn')),
  parent_uid TEXT,
  investor_introduction_id INTEGER REFERENCES investor_introductions(id) ON DELETE SET NULL,
  intro_proposition_id INTEGER REFERENCES intro_propositions(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_requester ON relationship_interactions(requester_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_teammate ON relationship_interactions(teammate_user_id, status, created_at);
