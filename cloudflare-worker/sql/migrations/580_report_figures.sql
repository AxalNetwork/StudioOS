-- 580 — Reporting part 3: a report's frozen figures, its revisions and its
-- documents (D1059, #2929, part 3 of #2427). Reserved for this part by D1056 §6.
--
-- A REPORT IS STILL ONE `portfolio_updates` ROW (#2427: never a second updates
-- store). This adds what a report carries on that row:
--
--   kind                 'update' (Share an update, D654) or 'report' (built
--                        from the Grow modules for a reporting period, D1059).
--                        Every existing row is an update.
--   figures_json         the report's figures, each with its key, module,
--                        unit, value, source, as_of and the founder's choice
--                        (included, left out with a reason, a Mercury figure
--                        shared). Re-assembled from the stores while a draft;
--                        FROZEN when sent.
--   figures_sha256       SHA-256 of `figures_json`, lower-case hex. Send refuses
--                        when the draft the founder read is not the one stored
--                        (D712's `contentChanged`).
--   revision             1 for a first send; a correction is the next revision.
--   corrects_update_id   the revision this one corrects. A sent revision is
--                        never edited: a correction is a new row, and the old
--                        one reads "Corrected on [date]" from its corrector.
--   correction_reason    what the correction changes, in the founders' words
--                        (RPT6: "reason '[Stripe refund]'"). Shown to the
--                        recipients.
--
--   report_documents     a statement attached to a report: a PDF in the
--                        private `FILES` bucket under `reports/<project
--                        uid>/<report uid>/<document uid>.pdf`. The key never
--                        leaves the Worker; a document is served only through
--                        `GET /api/reporting/documents/:uid`, `no-store`.
--
-- MONEY. `figures_json` holds the figures a founder chose to report, in their
-- units as Grow stores them (US dollars for money). No amount column is added.
--
-- Two triggers hold what the routes do: a sent report's figures and digest
-- never change, and a revision is corrected at most once (the unique index).
--
-- Grep first (D689 D-t): no `kind`, `figures_json`, `figures_sha256`,
-- `revision`, `corrects_update_id` or `correction_reason` column on
-- `portfolio_updates`, and no `report_documents` table, exists in an earlier
-- migration or in schema_baseline.sql.
--
-- Additive: ADD COLUMN and CREATE ... IF NOT EXISTS. No row is changed.

ALTER TABLE portfolio_updates ADD COLUMN kind TEXT NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'report'));
ALTER TABLE portfolio_updates ADD COLUMN figures_json TEXT CHECK (figures_json IS NULL OR (json_valid(figures_json) AND json_type(figures_json) = 'array'));
ALTER TABLE portfolio_updates ADD COLUMN figures_sha256 TEXT CHECK (figures_sha256 IS NULL OR (length(figures_sha256) = 64 AND figures_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE portfolio_updates ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1);
ALTER TABLE portfolio_updates ADD COLUMN corrects_update_id INTEGER REFERENCES portfolio_updates(id);
ALTER TABLE portfolio_updates ADD COLUMN correction_reason TEXT CHECK (correction_reason IS NULL OR length(correction_reason) <= 280);

CREATE INDEX IF NOT EXISTS idx_pupdates_kind_project ON portfolio_updates (project_id, kind, period_start);
-- A revision is corrected once: the chain is a line, never a tree.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pupdates_corrects ON portfolio_updates (corrects_update_id) WHERE corrects_update_id IS NOT NULL;
-- One first-revision report draft per venture and period: preparing twice opens the same draft.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pupdates_report_draft ON portfolio_updates (project_id, period_start, period_end)
  WHERE kind = 'report' AND sent_at IS NULL AND corrects_update_id IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_pupdates_report_frozen
BEFORE UPDATE OF figures_json, figures_sha256, revision, corrects_update_id ON portfolio_updates
WHEN OLD.kind = 'report' AND OLD.sent_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a sent report is frozen: correct it as a new revision');
END;

CREATE TABLE IF NOT EXISTS report_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  update_id     INTEGER NOT NULL REFERENCES portfolio_updates(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  file_key      TEXT NOT NULL CHECK (file_key GLOB 'reports/*'),
  filename      TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 160),
  content_type  TEXT NOT NULL CHECK (content_type = 'application/pdf'),
  size_bytes    INTEGER NOT NULL CHECK (typeof(size_bytes) = 'integer' AND size_bytes > 0),
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
  label         TEXT CHECK (label IS NULL OR length(label) <= 120),
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_report_documents_update ON report_documents (update_id, id);
