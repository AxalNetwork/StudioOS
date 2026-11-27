-- D5058 (#5058, user licences 2/4 under #5047) — the lifecycle of Founder, Investor, Operating Partner and Advisor
-- licences, on the shared identity D5057 created.
--
-- WHERE IT LIVES (option A on #5058). Each user licence is a `licences` row: family `user`, holder `user`, holder id
-- the account. Its status, dates and revision are that row's. `account_licences` (D4472) stays what access reads: the
-- lifecycle writes keep it in step in the same batch, so the access union and every predicate built on it are
-- unchanged. `users.role` stays the primary licence and the only source of Admin; no licence makes an account Admin.
--
-- TYPES. `account_licences.licence` says `partner`; `licences.licence_type` says `operating_partner`. They are the
-- same licence, mapped one to one (services/userLicences.ts).
--
-- THIS FILE:
--   1. one licences row per user licence per account (partial unique index), so a renewal is a new TERM, never a
--      second licence;
--   2. `user_licence_terms`, append-only: each term's dates, its renewal terms and the agreement version it was
--      signed under. A renewal adds the next term; an earlier term is never edited, so historical terms and
--      agreement versions stay readable;
--   3. `user_licence_events`, append-only: which licence changed, from what to what, at which revision, why and by
--      whom;
--   4. the backfill: a licences row for every primary licence (`users.role`) and every additional grant
--      (`account_licences`; a revoked grant is backfilled `terminated`, since revoked rows stay recorded), each with
--      one `backfill` event. A second run inserts nothing.

CREATE UNIQUE INDEX IF NOT EXISTS idx_licences_one_user_licence
  ON licences (holder_id, licence_type) WHERE licence_family = 'user';

CREATE TABLE IF NOT EXISTS user_licence_terms (
  uid                 TEXT PRIMARY KEY,
  licence_uid         TEXT NOT NULL REFERENCES licences(uid),
  term_no             INTEGER NOT NULL CHECK (typeof(term_no) = 'integer' AND term_no >= 1),
  starts_on           TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on             TEXT CHECK (ends_on IS NULL OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- The agreement this term was signed under, as its template/version reference. NULL when none is recorded.
  agreement_version   TEXT CHECK (agreement_version IS NULL OR length(agreement_version) BETWEEN 1 AND 120),
  renewal_terms_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(renewal_terms_json)),
  reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (licence_uid, term_no),
  CHECK (ends_on IS NULL OR ends_on > starts_on)
);

CREATE TRIGGER IF NOT EXISTS user_licence_terms_no_update
BEFORE UPDATE ON user_licence_terms
BEGIN
  SELECT RAISE(ABORT, 'user_licence_terms rows are append-only (D5058): a renewal is the next term.');
END;

CREATE TRIGGER IF NOT EXISTS user_licence_terms_no_delete
BEFORE DELETE ON user_licence_terms
BEGIN
  SELECT RAISE(ABORT, 'user_licence_terms rows are append-only (D5058).');
END;

CREATE TABLE IF NOT EXISTS user_licence_events (
  id            INTEGER PRIMARY KEY,
  licence_uid   TEXT NOT NULL REFERENCES licences(uid),
  user_id       INTEGER NOT NULL,
  licence_type  TEXT NOT NULL CHECK (licence_type IN ('founder', 'investor', 'operating_partner', 'advisor')),
  action        TEXT NOT NULL CHECK (action IN ('backfill', 'grant', 'activate', 'suspend', 'resume', 'renewal_pending',
                                               'renew', 'expire', 'terminate')),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  revision      INTEGER NOT NULL CHECK (revision >= 0),
  reason        TEXT NOT NULL,
  actor_id      INTEGER,
  term_uid      TEXT REFERENCES user_licence_terms(uid),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_user_licence_events_licence ON user_licence_events (licence_uid, id);
CREATE INDEX IF NOT EXISTS idx_user_licence_events_user ON user_licence_events (user_id, id);

CREATE TRIGGER IF NOT EXISTS user_licence_events_no_update
BEFORE UPDATE ON user_licence_events
BEGIN
  SELECT RAISE(ABORT, 'user_licence_events rows are append-only (D5058).');
END;

CREATE TRIGGER IF NOT EXISTS user_licence_events_no_delete
BEFORE DELETE ON user_licence_events
BEGIN
  SELECT RAISE(ABORT, 'user_licence_events rows are append-only (D5058).');
END;

-- ── Backfill ───────────────────────────────────────────────────────────────
-- The uid and reference are derived from the account and the type, so a second run finds them and inserts nothing.

INSERT INTO licences
  (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, ends_on, renews_on,
   revision, territory_licence_id, origin, created_at, created_by_user_id)
SELECT 'ulic_' || u.id || '_' || x.type, 'USR-' || u.id || '-' || upper(x.type), 'user', x.type, 'user', CAST(u.id AS TEXT),
       'active', NULL, NULL, NULL, 0, NULL, 'app', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL
  FROM users u
  JOIN (SELECT 'founder' AS role, 'founder' AS type UNION ALL SELECT 'investor', 'investor'
        UNION ALL SELECT 'advisor', 'advisor' UNION ALL SELECT 'partner', 'operating_partner') x
    ON lower(u.role) = x.role
 WHERE NOT EXISTS (SELECT 1 FROM licences l WHERE l.licence_family = 'user' AND l.holder_id = CAST(u.id AS TEXT) AND l.licence_type = x.type)
   AND NOT EXISTS (SELECT 1 FROM licences l WHERE l.licence_ref = 'USR-' || u.id || '-' || upper(x.type));

INSERT INTO licences
  (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, ends_on, renews_on,
   revision, territory_licence_id, origin, created_at, created_by_user_id)
SELECT 'ulic_' || a.user_id || '_' || x.type, 'USR-' || a.user_id || '-' || upper(x.type), 'user', x.type, 'user', CAST(a.user_id AS TEXT),
       CASE WHEN a.revoked_at IS NULL THEN 'active' ELSE 'terminated' END, substr(a.granted_at, 1, 10), NULL, NULL,
       0, NULL, 'app', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), a.granted_by
  FROM account_licences a
  JOIN (SELECT 'founder' AS licence, 'founder' AS type UNION ALL SELECT 'investor', 'investor'
        UNION ALL SELECT 'advisor', 'advisor' UNION ALL SELECT 'partner', 'operating_partner') x
    ON a.licence = x.licence
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
   AND NOT EXISTS (SELECT 1 FROM licences l WHERE l.licence_family = 'user' AND l.holder_id = CAST(a.user_id AS TEXT) AND l.licence_type = x.type)
   AND NOT EXISTS (SELECT 1 FROM licences l WHERE l.licence_ref = 'USR-' || a.user_id || '-' || upper(x.type));

INSERT INTO user_licence_events (licence_uid, user_id, licence_type, action, from_status, to_status, revision, reason, actor_id)
SELECT l.uid, CAST(l.holder_id AS INTEGER), l.licence_type, 'backfill', NULL, l.status, l.revision,
       'Recorded from the existing account licence (D5058 backfill).', NULL
  FROM licences l
 WHERE l.licence_family = 'user'
   AND NOT EXISTS (SELECT 1 FROM user_licence_events e WHERE e.licence_uid = l.uid);
