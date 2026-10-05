-- D551 (#1144) — a founder's contact gets a strength and an organisation.
--
-- The founder Network desk (A6 of `Founder Workspaces Canvas.dc.html`) draws a
-- Strength column and an Organizations lens over the people a founder keeps in
-- `contacts`. Neither had a column: the desk printed "Not scored" and the
-- Organizations zone could group nobody, because `organizationOf` reads an
-- `organization` field no contact carried.
--
--   strength      the canvas's closed set: strong | warm | cool. NULL means
--                 nobody has set it, and the pages read that as "Not recorded",
--                 never as cool.
--   organization  free text as the founder writes it. NULL or blank is "no
--                 organisation recorded"; nothing is inferred from an email
--                 domain. #1023's investor side (IN3) reads the same column,
--                 so there is one organisation field for both.
--
-- Both are set by `PUT /api/contacts/:uid`, for the contact's owner only.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote
--
-- SQLite/D1 has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Replay safety on
-- a cold isolate comes from the PRAGMA-guarded bootstrap in contacts.ts
-- ensureSchema(), the same pattern as migrations 128 and 166.

ALTER TABLE contacts ADD COLUMN strength TEXT CHECK (strength IS NULL OR strength IN ('strong', 'warm', 'cool'));
ALTER TABLE contacts ADD COLUMN organization TEXT;
