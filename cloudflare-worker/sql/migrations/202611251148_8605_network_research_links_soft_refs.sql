-- D8605 (#8605): the Network-to-Research bridge keeps its Research targets as plain uids.
--
-- 202611191414_7672 declared network_directory_research_links.company_directory_uid and
-- .fund_directory_uid as REFERENCES research_company_directory(uid) and
-- research_fund_directory(uid). A fund list is re-imported by deleting that list's rows and
-- inserting them again (scripts/import-research-funds.py; migrations 429 and
-- 202611180052_7166), and D1 enforces foreign keys, so the first reviewed link to a fund would
-- have made the next re-import of its list fail at the deploy's migration step. Both columns
-- are now plain TEXT, as research_funds.catalogue_uid, raise_prospects.research_fund_uid and
-- research_project_subjects.directory_uid already are. Every other column, foreign key, CHECK
-- and both unique indexes are as 7672 declared them.
--
-- status gains 'needs_review': the importer sets it on a link whose fund uid moved or left the
-- catalogue. Only 'reviewed' is a link to any reader.
--
-- GOTCHAS: no transaction statements, no foreign_keys toggle, and the table is recreated
-- under its OWN name before the rows are copied back. No table, view or trigger references
-- this one, so the drop cascades nothing, and no Worker code reads or writes it. The table is
-- expected to be empty; the copy runs whatever it holds, and the file replays to the same rows.

PRAGMA defer_foreign_keys = TRUE;

DROP TABLE IF EXISTS network_directory_research_links_copy_8605;
CREATE TABLE IF NOT EXISTS network_directory_research_links_copy_8605 AS SELECT * FROM network_directory_research_links;

DROP TABLE network_directory_research_links;

-- Research catalogs are separate from company workspaces. A firm linked to a managed vehicle
-- is not identified as that vehicle. The two Research uids are plain references (D8605).
CREATE TABLE IF NOT EXISTS network_directory_research_links (
  uid TEXT PRIMARY KEY,
  organization_uid TEXT NOT NULL,
  organization_kind TEXT NOT NULL DEFAULT 'organization' CHECK (organization_kind = 'organization'),
  company_directory_uid TEXT,
  fund_directory_uid TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('company', 'fund_manager', 'managed_fund_vehicle')),
  source_record_uid TEXT NOT NULL,
  reviewed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewed_at TEXT NOT NULL,
  evidence_url TEXT NOT NULL CHECK (length(trim(evidence_url)) > 0),
  status TEXT NOT NULL DEFAULT 'reviewed' CHECK (status IN ('reviewed', 'needs_review', 'withdrawn')),
  FOREIGN KEY (organization_uid, organization_kind) REFERENCES network_directory_entries(uid, kind),
  FOREIGN KEY (source_record_uid, organization_uid, organization_kind) REFERENCES network_directory_source_records(uid, entry_uid, entry_kind),
  CHECK ((company_directory_uid IS NOT NULL) + (fund_directory_uid IS NOT NULL) = 1),
  CHECK ((target_kind = 'company' AND company_directory_uid IS NOT NULL) OR (target_kind IN ('fund_manager', 'managed_fund_vehicle') AND fund_directory_uid IS NOT NULL))
);

INSERT INTO network_directory_research_links
  (uid, organization_uid, organization_kind, company_directory_uid, fund_directory_uid, target_kind,
   source_record_uid, reviewed_by_user_id, reviewed_at, evidence_url, status)
SELECT uid, organization_uid, organization_kind, company_directory_uid, fund_directory_uid, target_kind,
       source_record_uid, reviewed_by_user_id, reviewed_at, evidence_url, status
  FROM network_directory_research_links_copy_8605;

DROP TABLE network_directory_research_links_copy_8605;

CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_research_company ON network_directory_research_links(company_directory_uid) WHERE company_directory_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_research_fund ON network_directory_research_links(fund_directory_uid) WHERE fund_directory_uid IS NOT NULL;
