-- D8253 (#8253): a prospect or customer (a `contacts` row, audience 'customer') may carry the country it is in, as
-- ISO 3166-1 alpha-2 (upper case). Nullable and untagged by default: a row nobody tagged is never counted for a market.
ALTER TABLE contacts ADD COLUMN country TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_project_country ON contacts(project_id, audience, country);
