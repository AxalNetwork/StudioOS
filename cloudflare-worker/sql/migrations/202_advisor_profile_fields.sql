-- 202 — the advisor profile fields the Expertise canvas asks for.
--
-- WHAT IS MISSING TODAY. `advisors` stores a display name, a bio, expertise and
-- sector tag arrays, a LinkedIn URL and an hourly rate. The Advisor Expertise
-- canvas asks its Profile zone for six more facts — headline, the stages an
-- advisor works at, the languages they work in, where they are, when they are
-- available, and a face — and none of them has anywhere to go.
--
-- The consequence is not merely a thin page. `/office-hours`'s ProfileCard
-- already POSTs `headline` and `timezone` to `/api/advisors/me`, which reads
-- neither, and then reports "Profile saved". Two of these columns exist so that
-- claim stops being false.
--
-- NAMES ARE PORTED, NOT INVENTED. `headline` and `timezone` are the FastAPI
-- dev model's own words (`backend/app/models/entities.py:1436-1465`, class
-- Advisor), which is also the vocabulary `/office-hours` was written against.
-- Reusing them means one word per fact across the two implementations instead
-- of a second dialect to translate at the boundary. The remaining four have no
-- counterpart in that model — they are canvas facts — and follow the shape the
-- table already uses for lists (`*_json`, mirroring expertise_json/sectors_json).
--
-- ALL NULLABLE, and that is the honest default rather than a shortcut. Every
-- one of these is a fact only the advisor holds. An unset stage list is not an
-- empty stage list, and CLAUDE.md's rule is that absent data reads as absent —
-- so the column stores NULL and the surface says "Not recorded" rather than
-- rendering a confident empty set. `expertise_json` and `sectors_json` default
-- to '[]' because they predate that rule; the new ones do not repeat it.
--
-- NO INDEXES. Nothing filters on these — the directory read
-- (`routes/advisors.ts:129`) selects every active advisor and filters in
-- memory. An index nothing uses is a write cost with no reader.

ALTER TABLE advisors ADD COLUMN headline TEXT;
ALTER TABLE advisors ADD COLUMN stages_json TEXT;
ALTER TABLE advisors ADD COLUMN languages_json TEXT;
ALTER TABLE advisors ADD COLUMN country TEXT;
ALTER TABLE advisors ADD COLUMN timezone TEXT;
ALTER TABLE advisors ADD COLUMN availability_note TEXT;
ALTER TABLE advisors ADD COLUMN headshot_url TEXT;
