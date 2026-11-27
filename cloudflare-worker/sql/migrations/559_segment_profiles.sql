-- 559 — Persona segments part 3: the segment profile store (D1000, #2815).
-- Reserved for this part by S21 in D997 §6 (#2378).
--
-- THE PROFILE. One row per segment key. The twelve personas are code
-- (`src/personas.ts`): their ids, sign-up questions, `profile` (D998) and
-- sidebar links stay there. What HQ writes about a segment lives here:
--   name          what the segment is called, 1 to 80 characters;
--   profile       founder, investor, advisor, partner, exploring, or any
--                 (the canvas's "Any profile");
--   status        active (sign-up offers it), draft (only admins place
--                 members in it) or retired (no new members; current members
--                 keep it until moved);
--   who           who they are, at most 280 characters, or NULL;
--   typical_json  the typical member: a JSON list of at most 4 lines;
--   needs_json    a JSON list of at most 6 needs, in HQ's order, each
--                 {"id","text","answered_by":[{"kind","ref"}]};
--   offers_json   {"programs":[program keys],"perks":[perk uids],
--                 "content":[article slugs]}. Sidebar links are not stored:
--                 they are the persona's `nav_extras` in code, which is what
--                 the sidebar draws. Events are not stored either: they are
--                 read from each event's own audience rule.
--   version       1 for the seed, then one more for each write; a write names
--                 the version it read, so two editors cannot overwrite each
--                 other.
--
-- THE SEED is the twelve as code describes them on this date: the label as
-- the name, D998's profile, and the short description as who they are. Every
-- segment starts Active, which is what sign-up offers today. No need, offer or
-- typical member is invented: those start empty, and the page reads an empty
-- list of needs as "Not recorded".
--
-- THE HISTORY. One row per change, with the fields it changed and their
-- values before and after. The seed writes one `seeded` row per segment.
--
-- Grep first (D689 D-t): no `segment_profiles` or `segment_profile_history`
-- table exists in an earlier migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS segment_profiles (
  key            TEXT    PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  profile        TEXT    NOT NULL
                 CHECK (profile IN ('founder', 'investor', 'advisor', 'partner', 'exploring', 'any')),
  status         TEXT    NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'draft', 'retired')),
  who            TEXT    CHECK (who IS NULL OR length(who) <= 280),
  typical_json   TEXT    NOT NULL DEFAULT '[]',
  needs_json     TEXT    NOT NULL DEFAULT '[]',
  offers_json    TEXT    NOT NULL DEFAULT '{"programs":[],"perks":[],"content":[]}',
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by     INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segment_profile_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_key    TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  action         TEXT    NOT NULL CHECK (action IN ('seeded', 'edited')),
  fields_json    TEXT    NOT NULL DEFAULT '[]',
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT    CHECK (reason IS NULL OR length(reason) <= 280),
  actor_user_id  INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_segment_profile_history_key ON segment_profile_history(segment_key, id);

INSERT OR IGNORE INTO segment_profiles (key, name, profile, who) VALUES
  ('lp_individual', 'LP — Individual', 'investor', 'Individual limited partner committing personal capital to the main fund.'),
  ('lp_institutional', 'LP — Institutional', 'investor', 'Institutional LP (endowment, foundation, pension, fund-of-funds).'),
  ('gp_external', 'GP — External Fund', 'investor', 'GP running an external fund interested in deal-by-deal collaboration.'),
  ('angel_scout', 'Angel / Scout', 'investor', 'Individual angel or scout sourcing and writing small early checks.'),
  ('corporate_vc', 'Corporate VC', 'investor', 'Strategic / corporate VC arm of an operating company.'),
  ('sovereign_family_office', 'Sovereign / Family Office', 'investor', 'Sovereign wealth, family office, or multi-family office investor.'),
  ('academic', 'Academic / Lab', 'exploring', 'Academic researcher, university tech-transfer office, or research lab.'),
  ('founder_new', 'Founder — New Venture', 'founder', 'Founder spinning out a brand-new venture through the 28-day engine.'),
  ('founder_existing', 'Founder — Existing Company', 'founder', 'Founder of an existing company on the Strategic Scale partnership track.'),
  ('operator_advisor', 'Operator / Advisor', 'advisor', 'Operating partner or advisor offering sweat-equity expertise to spin-outs.'),
  ('service_provider', 'Service Provider', 'partner', 'Legal, technical, or other service provider to the studio.'),
  ('press_analyst', 'Press / Analyst', 'exploring', 'Journalist, industry analyst, or research publication.');

INSERT INTO segment_profile_history (segment_key, version, action, fields_json, after_json)
SELECT s.key, 1, 'seeded', '["name","profile","status","who"]',
       json_object('name', s.name, 'profile', s.profile, 'status', s.status, 'who', s.who)
  FROM segment_profiles s
 WHERE NOT EXISTS (SELECT 1 FROM segment_profile_history h WHERE h.segment_key = s.key AND h.action = 'seeded');
