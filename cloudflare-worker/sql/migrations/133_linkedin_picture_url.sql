-- Task #67 — Autopopulate profiles from LinkedIn.
--
-- Capture the LinkedIn profile photo URL at OAuth callback so the "Import from
-- connected account" flow can propose it as a headshot. The URL is a
-- LinkedIn CDN (licdn.com) link; apply-time fetching is host-allowlisted to
-- prevent SSRF. Not a secret.
ALTER TABLE users ADD COLUMN linkedin_picture_url TEXT;
