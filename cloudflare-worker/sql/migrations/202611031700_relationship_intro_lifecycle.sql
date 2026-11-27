-- D4329 (#4329, D1357 part 8a): the introduction request lifecycle, over
-- migration 653's relationship_interactions.
--
-- relationship_interactions is rebuilt (id-keeping, as 762 and 763 did),
-- because SQLite cannot widen a CHECK in place:
--   - status gains 'accepted': Accept and Made are two steps. Made is recorded
--     when the introducer sends the intro through the Email composer (#3547),
--     and `mail_sent_uid` names that send;
--   - kind gains 'intro_accepted' and 'intro_withdrawn' (the event rows a
--     decision or a withdrawal writes, with parent_uid, as 653's intro_made
--     and intro_declined do);
--   - context_note: the optional context for the person, which only the
--     teammate reads and may forward (at most 1000 characters);
--   - decision_note: the teammate's note the asker reads, on Accept or Not now;
--   - outcome / outcome_note on a `kind = 'outcome'` row, recorded by either
--     side. Until one is recorded the log reads "Not recorded";
--   - accepted_at, made_at, withdrawn_at: when each step happened.
--
-- relationship_follow_ups (new): a member's own follow-up on a request, with a
-- due date, done and snoozed until. One per member and request.
--
-- No row names a contact detail: person_key stays the URL or email key 653
-- already kept, and nothing here adds an email, phone or profile URL.
-- No transaction statements (D1 rejects them).
CREATE TABLE relationship_interactions_8a (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('intro_requested', 'intro_accepted', 'intro_made', 'intro_declined', 'intro_withdrawn', 'meeting', 'outcome')),
  requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teammate_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_key TEXT NOT NULL,
  contact_id INTEGER,
  person_key TEXT,
  person_name TEXT NOT NULL,
  person_company TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'made', 'declined', 'withdrawn')),
  parent_uid TEXT,
  investor_introduction_id INTEGER REFERENCES investor_introductions(id) ON DELETE SET NULL,
  intro_proposition_id INTEGER REFERENCES intro_propositions(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  context_note TEXT CHECK (context_note IS NULL OR length(context_note) <= 1000),
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('meeting_held', 'replied', 'no_reply', 'not_a_fit')),
  outcome_note TEXT CHECK (outcome_note IS NULL OR length(outcome_note) <= 500),
  recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mail_sent_uid TEXT,
  accepted_at TEXT,
  made_at TEXT,
  withdrawn_at TEXT,
  CHECK ((kind = 'outcome') = (outcome IS NOT NULL))
);
INSERT INTO relationship_interactions_8a (id, uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name,
    person_company, note, status, parent_uid, investor_introduction_id, intro_proposition_id, decided_at, created_at, made_at)
  SELECT id, uid, kind, requester_user_id, teammate_user_id, team_key, contact_id, person_key, person_name,
    person_company, note, status, parent_uid, investor_introduction_id, intro_proposition_id, decided_at, created_at,
    CASE WHEN status = 'made' THEN decided_at END
    FROM relationship_interactions WHERE kind <> 'outcome';
UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'relationship_interactions')) WHERE name = 'relationship_interactions_8a';
DROP TABLE relationship_interactions;
ALTER TABLE relationship_interactions_8a RENAME TO relationship_interactions;
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_requester ON relationship_interactions(requester_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_teammate ON relationship_interactions(teammate_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_parent ON relationship_interactions(parent_uid, kind, created_at);

CREATE TABLE IF NOT EXISTS relationship_follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  request_uid TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_on TEXT NOT NULL CHECK (due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at TEXT,
  snoozed_until TEXT CHECK (snoozed_until IS NULL OR snoozed_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_uid, user_id)
);
CREATE INDEX IF NOT EXISTS idx_relationship_follow_ups_user ON relationship_follow_ups(user_id, done_at, due_on);
