-- #5960 (D5960): a deliverable version's document may be a stored file instead of a web link.
--
-- A version's document is a link (`link_url`, https only, D4712) or a file stored in R2 `FILES`, never neither:
-- the routes refuse an empty version (422 `empty_version`). The file's bytes are put first and this row is written
-- only after the put succeeds, as `routes/company_documents.ts` does, under the same 10 MB cap and the same sniffed
-- types (PDF, JPEG, PNG).
--
--   file_key      the R2 key. Never returned by any route.
--   file_name     the name the advisor uploaded it under, for the download's filename.
--   file_type     the sniffed content type (the bytes decide it, not the declared type).
--   file_size     bytes.
--   file_sha256   the bytes' hash, recorded as metadata. Never returned by any route.
--
-- VERSIONS ARE IMMUTABLE (D4712). No route replaces or deletes a stored file, so these are written once, at the
-- version's creation, and every version written before this reads all five as NULL (a link, or no document).
ALTER TABLE advisor_deliverable_versions ADD COLUMN file_key TEXT;
ALTER TABLE advisor_deliverable_versions ADD COLUMN file_name TEXT;
ALTER TABLE advisor_deliverable_versions ADD COLUMN file_type TEXT;
ALTER TABLE advisor_deliverable_versions ADD COLUMN file_size INTEGER;
ALTER TABLE advisor_deliverable_versions ADD COLUMN file_sha256 TEXT;
