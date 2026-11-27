-- 202611091201_governance_relations.sql — D4811 (#4811) part 8: related
-- documents for a Corporate Governance record (board CT-11). Additive: two new
-- tables, no existing table changes.
--
-- 1. `governance_relations`: one row per "this record governs that document"
--    link, made by an HQ admin. The dependant is another governance record
--    (`dependent_kind = 'governance'`, its uid) or a template in the library
--    (`'template'`, its slug). A link is a reference: it copies nothing and
--    changes neither document.
--    - `flag_version`: the governing record's version when it last became
--      Approved or Executed at a version newer than the one before. Written by
--      the governance PATCH, never by hand.
--    - `reviewed_version` / `reviewed_by` / `reviewed_at` / `review_note`: the
--      governing version a person last checked this dependant against, who,
--      when and what they noted. A dependant "may require review" while
--      `flag_version` is set and `reviewed_version` is NULL or older. Nothing
--      in the dependant is rewritten, ever (CT-11).
-- 2. `governance_relation_dismissals`: "Dismiss for me" on the banner, per
--    admin and per governing version: it hides the banner for that admin only,
--    until a newer version raises it again. The flags stay.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS governance_relations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  governing_uid    TEXT NOT NULL REFERENCES governance_documents(uid),
  dependent_kind   TEXT NOT NULL CHECK (dependent_kind IN ('governance','template')),
  dependent_ref    TEXT NOT NULL CHECK (length(dependent_ref) BETWEEN 1 AND 200),
  flag_version     INTEGER CHECK (flag_version IS NULL OR (typeof(flag_version) = 'integer' AND flag_version >= 0)),
  flagged_at       TEXT,
  reviewed_version INTEGER CHECK (reviewed_version IS NULL OR (typeof(reviewed_version) = 'integer' AND reviewed_version >= 0)),
  reviewed_by      INTEGER,
  reviewed_at      TEXT,
  review_note      TEXT CHECK (review_note IS NULL OR length(review_note) <= 500),
  created_by       INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (governing_uid, dependent_kind, dependent_ref),
  -- A record does not govern itself.
  CHECK (dependent_kind <> 'governance' OR dependent_ref <> governing_uid)
);
CREATE INDEX IF NOT EXISTS idx_governance_relations_dependent ON governance_relations(dependent_kind, dependent_ref);

CREATE TABLE IF NOT EXISTS governance_relation_dismissals (
  user_id        INTEGER NOT NULL,
  governing_uid  TEXT NOT NULL REFERENCES governance_documents(uid),
  flag_version   INTEGER NOT NULL CHECK (typeof(flag_version) = 'integer' AND flag_version >= 0),
  dismissed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (user_id, governing_uid)
);
