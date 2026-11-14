-- Task #4 — Salesforce integration. Adds external-id columns so we can
-- join StudioOS records to their Salesforce counterparts during sync/push.
--
-- D1 (SQLite) re-runs of ALTER TABLE will error on duplicate columns;
-- that's expected and idempotent at the file level (D1 rolls the file
-- back, but each ALTER is a no-op on subsequent runs after first apply).

ALTER TABLE deals ADD COLUMN sf_opportunity_id TEXT;
ALTER TABLE projects ADD COLUMN sf_account_id TEXT;
ALTER TABLE projects ADD COLUMN sf_primary_contact_id TEXT;
ALTER TABLE founders ADD COLUMN sf_contact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_sf_opp ON deals(sf_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_projects_sf_account ON projects(sf_account_id);
CREATE INDEX IF NOT EXISTS idx_founders_sf_contact ON founders(sf_contact_id);
