-- Task #1 (Merge Team & Mentors People Slide) — add editable
-- company / affiliation to founders so the merged people slide can show
-- each founder's affiliation alongside the network roster. Additive;
-- the worker carries a lazy ALTER (ensureFounderCompanyColumn) in
-- routes/projects.ts so the column self-heals on prod.
ALTER TABLE founders ADD COLUMN company TEXT;
