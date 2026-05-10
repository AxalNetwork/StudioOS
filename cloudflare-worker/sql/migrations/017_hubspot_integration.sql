-- Task #2 — HubSpot integration. Adds external-id columns so we can join
-- StudioOS records to their HubSpot counterparts during sync/push.
--
-- D1 (SQLite) re-runs of ALTER TABLE will error on duplicate columns;
-- that's expected and idempotent at the file level (D1 rolls the file
-- back, but each ALTER is a no-op on subsequent runs after first apply).

ALTER TABLE deals ADD COLUMN hubspot_deal_id TEXT;
ALTER TABLE projects ADD COLUMN hubspot_company_id TEXT;
ALTER TABLE projects ADD COLUMN hubspot_primary_contact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_hubspot ON deals(hubspot_deal_id);
CREATE INDEX IF NOT EXISTS idx_projects_hubspot_company ON projects(hubspot_company_id);
