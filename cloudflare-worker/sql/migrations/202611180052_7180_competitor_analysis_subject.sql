-- D7180 (#7180, D7046 and D7041) — the company a competitor analysis is about.
--
-- `competitor_analyses` had no subject column: a profile's "Set up competitor
-- analysis →" link put the company's name into Market / industry and its
-- website into Known competitors, and nothing kept which company the run was
-- about, so Direct and Adjacent could not name what they compete with.
--
-- `subject_uid` is `research_company_directory.uid`, the directory company
-- the profile link opened setup with. NULL is "no subject": every analysis
-- written before this file, and every run started outside a profile. The
-- Worker checks the uid against the directory when it writes it
-- (routes/competitors.ts) and reads the name, website, country and sector
-- label back from the directory on each read, so nothing here is copied.
--
-- Expand only: one nullable column, no default needed, nothing rewritten.
-- services/competitorSchema.ts's runtime CREATE TABLE declares the same column.
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

ALTER TABLE competitor_analyses ADD COLUMN subject_uid TEXT;
