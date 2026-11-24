-- D7817 (#7817) — a Research Project keeps a frozen copy of a saved analysis
-- version, and a finding may cite a source of that copy.
--
-- WHY A COPY. Only superseded competitor-analysis versions are stored
-- (`competitor_analysis_versions`, migration 202611180053_7176), a refresh
-- changes the sources without a new version, and deleting an analysis deletes
-- its versions. A finding that cited the live analysis would change under it or
-- lose its footing. Attaching copies the version into the project once, and
-- the copy never changes afterwards.
--
-- `research_project_attachments`
--     One attached object per row: the project, its owner, the kind, the
--     object's id and version, a title, the copy (`copy_json`) with its format
--     number, and when it was attached. Kind is checked against one exported
--     list in `services/researchProjectAttachments.ts`, not by a table
--     constraint, so a later kind is a service change and no migration. There
--     is no reference to `competitor_analyses`: deleting the analysis must not
--     delete the copy. One row per project, kind, object and version, so a
--     repeated attach returns the existing row. This is not
--     `research_attachments` (migration 222), which holds Library uploads.
--
-- `research_project_finding_citations` gains nullable columns, all additive:
--     `attachment_id`  the attachment the cited source belongs to; NULL once
--                      that attachment is detached (the citation then reads
--                      "attachment removed" and keeps what it froze);
--     `source_key`     the source's key in the copy (set for every citation of
--                      an attached source, so it tells the two kinds apart);
--     `source_url`     the source's link as the copy recorded it;
--     `retrieved_at`   the source's retrieval date as the copy recorded it.
--     No passage is stored for an analysis source yet (#7839), so `passage`
--     stays NULL on these rows.
--
-- `research_project_findings` gains `attachment_id` and `attachment_finding_n`:
--     a generated finding taken over from an attached copy is an
--     interpretation, exactly as one taken from an Ask answer (state and
--     `proposed_text` are required by the existing CHECKs), and these two name
--     which generated finding it was. The partial unique index keeps one
--     decision per generated finding per attachment. A detach sets
--     `attachment_id` NULL and never touches `updated_at`.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS research_project_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  object_id       TEXT NOT NULL,
  object_version  INTEGER NOT NULL CHECK (object_version >= 1),
  title           TEXT NOT NULL,
  copy_format     INTEGER NOT NULL CHECK (copy_format >= 1),
  copy_json       TEXT NOT NULL,
  attached_by     INTEGER NOT NULL REFERENCES users(id),
  attached_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, object_id, object_version)
);

-- The project's attachment list, newest first.
CREATE INDEX IF NOT EXISTS idx_research_project_attachments_project
  ON research_project_attachments(project_id, id DESC);

ALTER TABLE research_project_finding_citations ADD COLUMN attachment_id INTEGER REFERENCES research_project_attachments(id) ON DELETE SET NULL;

ALTER TABLE research_project_finding_citations ADD COLUMN source_key TEXT;

ALTER TABLE research_project_finding_citations ADD COLUMN source_url TEXT;

ALTER TABLE research_project_finding_citations ADD COLUMN retrieved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_research_project_finding_citations_attachment
  ON research_project_finding_citations(attachment_id);

ALTER TABLE research_project_findings ADD COLUMN attachment_id INTEGER REFERENCES research_project_attachments(id) ON DELETE SET NULL;

ALTER TABLE research_project_findings ADD COLUMN attachment_finding_n INTEGER;

-- One decision per generated finding per attachment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_project_findings_attachment
  ON research_project_findings(project_id, attachment_id, attachment_finding_n)
  WHERE kind = 'interpretation' AND attachment_id IS NOT NULL;
