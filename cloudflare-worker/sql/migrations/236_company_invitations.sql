-- 236 — company_invitations, so "Invite by email" can stop being a lookup.
--
-- WHAT IT DOES TODAY. `POST /company/:uid/members` resolves the address to an
-- EXISTING user row and 404s otherwise, then writes `user_company_links`
-- directly. There is no invitation record and no email: the person is linked
-- without being asked, and someone who has never signed up cannot be reached
-- at all. `CompanySettingsPage.jsx` was honest about it in a comment —
-- "Invite by email is not an invite" — which is the right thing to write down
-- and the wrong thing to leave true.
--
-- ONLY THE HASH IS STORED. The token goes to the recipient's inbox and is
-- returned to the caller exactly once, at creation, so it can be put in a
-- link. A readable token column would make the invitations table a set of
-- working keys to every company in the product — the same reasoning as
-- `project_member_invitations`, whose shape this deliberately mirrors so the
-- two are read the same way.
--
-- STATUS IS A CLOSED SET AND CARRIES A CHECK, because unlike migration 235
-- this is a new table rather than an added column, so SQLite will take one.
-- 'expired' is written lazily by the accept path when it finds a pending row
-- past its date: a background sweep would be a second writer for a fact the
-- reader already has to compute.
--
-- ONE PENDING INVITATION PER ADDRESS PER COMPANY, enforced by a partial unique
-- index rather than a lookup-then-insert in the route. Two admins inviting the
-- same person at the same moment is exactly the race a check-first loses, and
-- the second one should resend rather than create a duplicate. Revoked and
-- accepted rows stay, so the same address can be re-invited later and the
-- history of who asked whom survives.
--
-- No BEGIN/COMMIT — D1 rejects them.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/236_company_invitations.sql

CREATE TABLE IF NOT EXISTS company_invitations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT    NOT NULL UNIQUE,
  -- `company_profiles`, NOT `companies`. Both tables exist; the one this
  -- product's company routes read is company_profiles (every SELECT in
  -- routes/company.ts), while `companies` comes from migration 034 and is not
  -- touched by any of them. Pointing this at the wrong one would have made
  -- the constraint enforce nothing and pointed the next reader at a dead
  -- table — the same class of error as the calendar_events shape mismatch.
  company_id          INTEGER NOT NULL REFERENCES company_profiles(id),
  -- Normalised (trimmed, lower-cased) by the route before it lands here, so
  -- the unique index below and the match at accept time agree.
  email               TEXT    NOT NULL,
  role_in_company     TEXT    NOT NULL DEFAULT 'Member',
  -- The other two axes migration 191 separated. Carried on the invitation so
  -- accepting reproduces what the inviter chose, rather than defaulting and
  -- making someone set it again afterwards.
  title               TEXT,
  authority           TEXT,
  token_hash          TEXT    NOT NULL UNIQUE,
  status              TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  accepted_by_user_id INTEGER REFERENCES users(id),
  -- Whether the message actually left. The mailer returns false when Gmail
  -- credentials are absent, and an invitation nobody was told about is a
  -- different thing from one that is merely unanswered — the page says which.
  email_sent          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT    NOT NULL,
  accepted_at         TEXT,
  revoked_at          TEXT
);

-- The list the settings page reads: this company's invitations, newest first.
CREATE INDEX IF NOT EXISTS idx_company_invitations_company
  ON company_invitations(company_id, status, created_at);

-- Accept is a lookup by hash and nothing else.
CREATE INDEX IF NOT EXISTS idx_company_invitations_token
  ON company_invitations(token_hash);

-- The race guard described above. Partial, so only PENDING rows collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_invitations_one_pending
  ON company_invitations(company_id, email) WHERE status = 'pending';
