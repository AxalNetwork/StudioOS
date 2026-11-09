-- D4811 (#4811) part 16 — the legal-review record (board CT-08), with the
-- counsel role the owner chose on 2026-11-09 (question C): only counsel
-- records an approval, and only against the exact version it reviewed.
--
-- 1. `counsel_members`: who holds the counsel role. Granted and revoked by the
--    Super Admin (a side table, as `super_admins` is), never inferred.
-- 2. `legal_reviews`: one review of one version of a template or governance
--    record, bound to that version's SHA-256. An HQ admin requests it and
--    names the reviewing counsel; the assigned counsel records the decision
--    once (findings, required changes, sources, next review, decision). A
--    newer version needs a new review: the old one stays, bound to its hash.
--    The request row is never rewritten, and a decision is never changed:
--    the trigger refuses any UPDATE except the one that records the decision.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS counsel_members (
  user_id     INTEGER PRIMARY KEY,
  firm        TEXT CHECK (firm IS NULL OR length(firm) <= 200),
  granted_by  INTEGER,
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS legal_reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  object_kind      TEXT NOT NULL CHECK (object_kind IN ('template','governance')),
  object_ref       TEXT NOT NULL CHECK (length(object_ref) BETWEEN 1 AND 120),
  version          INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  version_sha256   TEXT NOT NULL CHECK (length(version_sha256) = 64),
  review_type      TEXT NOT NULL CHECK (review_type IN ('initial','amendment','pre_execution','periodic')),
  jurisdiction     TEXT NOT NULL CHECK (length(jurisdiction) BETWEEN 2 AND 120),
  reviewer_id      INTEGER NOT NULL,
  due_on           TEXT,
  requested_by     INTEGER NOT NULL,
  requested_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  decision         TEXT CHECK (decision IS NULL OR decision IN ('approved','approved_with_conditions','not_approved')),
  findings         TEXT CHECK (findings IS NULL OR length(findings) <= 4000),
  required_changes TEXT CHECK (required_changes IS NULL OR length(required_changes) <= 4000),
  sources          TEXT CHECK (sources IS NULL OR length(sources) <= 2000),
  next_review_on   TEXT,
  decided_by       INTEGER,
  decided_at       TEXT
);

CREATE INDEX IF NOT EXISTS ix_legal_reviews_object ON legal_reviews(object_kind, object_ref, id);

CREATE TRIGGER IF NOT EXISTS legal_reviews_decide_once
BEFORE UPDATE ON legal_reviews
WHEN OLD.decision IS NOT NULL
  OR NEW.object_kind IS NOT OLD.object_kind OR NEW.object_ref IS NOT OLD.object_ref
  OR NEW.version IS NOT OLD.version OR NEW.version_sha256 IS NOT OLD.version_sha256
  OR NEW.review_type IS NOT OLD.review_type OR NEW.jurisdiction IS NOT OLD.jurisdiction
  OR NEW.reviewer_id IS NOT OLD.reviewer_id OR NEW.requested_by IS NOT OLD.requested_by
  OR NEW.requested_at IS NOT OLD.requested_at OR NEW.due_on IS NOT OLD.due_on
BEGIN
  SELECT RAISE(ABORT, 'legal_reviews: a request is never rewritten and a decision is recorded once (D4811).');
END;

CREATE TRIGGER IF NOT EXISTS legal_reviews_block_delete
BEFORE DELETE ON legal_reviews
BEGIN
  SELECT RAISE(ABORT, 'legal_reviews is append-only (D4811).');
END;
