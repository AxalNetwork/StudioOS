-- Task #2 — Project data-room URL
-- Additive, IF NOT EXISTS via lazy bootstrap in routes/projects.ts.
-- Adds two columns to `projects` so the data-room link + NDA flag can
-- be edited once on the project and reused by the Spin-Out Demo Day
-- deck's "Review the deal" slide and any future surface (investor
-- landing, follow-up emails, dashboard).
ALTER TABLE projects ADD COLUMN data_room_url TEXT;
ALTER TABLE projects ADD COLUMN data_room_nda_required INTEGER NOT NULL DEFAULT 0;
