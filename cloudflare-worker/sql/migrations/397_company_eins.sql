-- 397 — company_eins: a startup's EIN, encrypted at rest (D579, #1206; the
-- owner's answers 1A and 2A).
--
-- An EIN is a tax identifier, and #1009 treats it as personal data. So it has
-- a table of its own, keyed to the project: not `users` (at D1's column cap)
-- and not `incorporation_meta`, which the browser writes.
--
--   ein_enc     the number, AES-256-GCM through services/columnCipher.ts (the
--               cipher integrations/secrets.ts wraps), with the AAD
--               `company_eins:ein_enc:<project_id>`, so a ciphertext copied onto
--               another project's row does not decrypt. Never plaintext: the
--               CHECK holds the cipher's `v1.` prefix.
--   ein_last4   the last four digits, the only part shown outside the founder's
--               own edit field.
--   recorded_by the account that last wrote it: a founder, a company editor or an
--               admin (an admin write is also recorded through logAdminAction,
--               without the number).
--
-- Readers (2A): the startup's founder and company editors, and admins. Nobody
-- else, investors in the data room included (routes/company_ein.ts).
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS company_eins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id  INTEGER NOT NULL UNIQUE REFERENCES projects(id),
  ein_enc     TEXT NOT NULL CHECK (ein_enc LIKE 'v1.%'),
  ein_last4   TEXT NOT NULL CHECK (length(ein_last4) = 4 AND ein_last4 GLOB '[0-9][0-9][0-9][0-9]'),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
