-- D6052 (#6052): who invited which raise prospect to Axal, and the account that joined.
--
-- `POST /api/contacts/invite` with a `prospect_id` (routes/contacts.ts) writes one row per invitation it
-- tries to send: the venture, the prospect, the founder who sent it, when, the address it went to and
-- whether the email left. `accepted_user_id` and `accepted_at` are stamped once an account with that
-- address exists (services/prospectInvites.ts). A row never adds anyone to a call's audience: the call
-- still chooses only an active investor whose KYC is approved (services/roundCalls.ts).
CREATE TABLE IF NOT EXISTS raise_prospect_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prospect_id INTEGER NOT NULL REFERENCES raise_prospects(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  invited_by INTEGER NOT NULL REFERENCES users(id),
  invited_at TEXT NOT NULL,
  email_sent INTEGER NOT NULL DEFAULT 0 CHECK (email_sent IN (0, 1)),
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_raise_prospect_invites_prospect ON raise_prospect_invites(prospect_id, invited_at);
CREATE INDEX IF NOT EXISTS idx_raise_prospect_invites_project ON raise_prospect_invites(project_id, accepted_user_id);
