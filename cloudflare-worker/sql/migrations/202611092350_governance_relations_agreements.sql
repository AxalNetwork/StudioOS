-- D4811 (#4811) part 19 — related-document links that name agreements (board
-- CT-11): a governance record (an LPA, an operating agreement) governs the
-- agreements made under it as well as other records and templates. The
-- dependant kind is fixed by a CHECK on `governance_relations`, so the table
-- is rebuilt with 'agreement' allowed (an agreement uid the Contracts desk
-- uses), every row copied as it was, and the index restored. Nothing else
-- changes: the flags, reviews and dismissals keep their meaning.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS governance_relations_v2 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  governing_uid    TEXT NOT NULL REFERENCES governance_documents(uid),
  dependent_kind   TEXT NOT NULL CHECK (dependent_kind IN ('governance','template','agreement')),
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
  CHECK (dependent_kind <> 'governance' OR dependent_ref <> governing_uid)
);

INSERT INTO governance_relations_v2 (id, governing_uid, dependent_kind, dependent_ref, flag_version, flagged_at, reviewed_version, reviewed_by, reviewed_at, review_note, created_by, created_at)
  SELECT id, governing_uid, dependent_kind, dependent_ref, flag_version, flagged_at, reviewed_version, reviewed_by, reviewed_at, review_note, created_by, created_at
  FROM governance_relations;

DROP TABLE governance_relations;
ALTER TABLE governance_relations_v2 RENAME TO governance_relations;
CREATE INDEX IF NOT EXISTS idx_governance_relations_dependent ON governance_relations(dependent_kind, dependent_ref);
