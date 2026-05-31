-- Task #1 (Merge Team & Mentors People Slide) — add editable
-- company / affiliation to the admin-managed network roster. Additive;
-- the worker carries a lazy ALTER in ensureNetworkProfilesSchema() so
-- the column self-heals on prod even before this migration is applied.
ALTER TABLE network_profiles ADD COLUMN company TEXT;
