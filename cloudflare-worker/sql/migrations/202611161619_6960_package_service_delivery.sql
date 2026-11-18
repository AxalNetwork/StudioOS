-- D6960: a published package version freezes any explicitly described HQ service.
-- A null description retains the historic local program grant for every existing item.
ALTER TABLE program_package_items ADD COLUMN hq_service_description TEXT
  CHECK (hq_service_description IS NULL OR length(trim(hq_service_description)) BETWEEN 1 AND 500);
