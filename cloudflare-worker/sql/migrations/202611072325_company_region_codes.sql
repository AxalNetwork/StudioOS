-- 202611072325 — company_profiles.region_codes: the company's regions as canonical codes (#4964).
-- Named by its UTC minute (D4106).
--
-- The General page says regions match a company with investors, advisors and events, but they lived only in
-- `international_presence`, one comma-separated free-text column. `region_codes` holds a JSON array of the codes in
-- `services/companyProfileVocab.ts` (`REGIONS`), the form's checkboxes write it, and `international_presence`
-- stays as optional prose.
--
-- NO BACKFILL HERE, ON PURPOSE. Mapping free text to codes is the alias table's job, which lives in code where it is
-- tested; a row with NULL `region_codes` is read with codes derived from its text, every entry no alias covers listed
-- as unmapped, and stored on its next General save. Nothing existing is rewritten or dropped.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE company_profiles ADD COLUMN region_codes TEXT;
