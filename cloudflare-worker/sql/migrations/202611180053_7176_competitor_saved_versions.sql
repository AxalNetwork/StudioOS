-- D7176 (#7176, canvas D7042): saved competitor analyses keep the researcher's
-- work through refresh, rerun and export.
--
--   competitor_sources.origin
--       'fetched' (a run, a crawl or a refresh fetched the page) or 'manual'
--       (attached by hand through POST /:id/candidates/:cid/sources). Refresh
--       and rerun never delete a manual row. Every row on record before this
--       file is 'fetched': the store could not tell an attached source from a
--       fetched one until now.
--   competitor_analysis_outputs.version
--       The saved version. Each save (PATCH /:id, and applying a rerun) adds
--       one; a save based on an older version answers 409.
--   competitor_analysis_outputs.sections_edited_json
--       { "<output field>": "<ISO time of the person's last edit>" }, kept by
--       refresh and rerun, cleared for a field only when a rerun rewrite of it
--       is accepted.
--   competitor_analysis_versions
--       The superseded versions, one row each, written when a save replaces
--       them, so an export can name an older version.
--   competitor_rerun_proposals
--       The one pending rerun proposal per analysis. A rerun writes here and
--       nowhere else; the apply step reads it with If-Match on base_version.
--
-- Additive only: two columns with defaults and two new tables.

ALTER TABLE competitor_sources ADD COLUMN origin TEXT NOT NULL DEFAULT 'fetched';

ALTER TABLE competitor_analysis_outputs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE competitor_analysis_outputs ADD COLUMN sections_edited_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS competitor_analysis_versions (
  analysis_id   TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  saved_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (analysis_id, version)
);

CREATE TABLE IF NOT EXISTS competitor_rerun_proposals (
  analysis_id  TEXT PRIMARY KEY REFERENCES competitor_analyses(id) ON DELETE CASCADE,
  proposal_id  TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  base_version INTEGER NOT NULL,
  inputs_json  TEXT NOT NULL DEFAULT '{}',
  result_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
