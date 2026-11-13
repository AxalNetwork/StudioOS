-- 263 — the destination branch's side of a cross-branch account move (D121).
--
-- WHAT D.6 ACTUALLY IS, because the name undersells it. "Move an account to
-- another branch" is not a directory edit: a branch is a licence, and which
-- branch holds an account decides which subsidiary earns revenue share on it.
-- The subsidiary canvas calls it "a money action wearing a directory action's
-- clothes". So it is audited on both sides and it carries a reason.
--
-- AND IT IS NOT A RECORD MIGRATION. D.6 is explicit: projects, deals and
-- documents STAY WHERE THEY WERE, readable by HQ. The account is closed where
-- it lives and re-invited on the destination; the person signs in again and
-- starts fresh there. A half-migration — some rows moved, some not, references
-- pointing across a database boundary that does not exist — would be worse than
-- none, which is why the decision chose re-invite over migration.
--
-- WHY A BRANCH-LOCAL TABLE AND NOT A SHARED ONE. A branch is its own Worker
-- over its own database (D.2); it cannot read HQ's, and HQ's invitation list
-- would be unreadable exactly where the invitation has to be accepted. This
-- lives on the destination.
--
-- SHAPED ON `company_invitations` (migration 236), which is the same problem one
-- scope down and had already answered the question that looked open here:
--
--     "Whether the message actually left. The mailer returns false when Gmail
--      credentials are absent, and an invitation nobody was told about is a
--      different thing from one that is merely unanswered — the page says which."
--
-- That is `email_sent` below, and it is the honest-state column this table
-- needed. Every sender in `services/email.ts` guards on the Gmail credentials
-- and RETURNS FALSE rather than throwing, so the value is true by construction:
-- a branch whose mail is not configured records an invitation nobody was told
-- about, and HQ sees that rather than a silent success.
--
-- `invited_by_name` IS A NAME, NOT AN ID — the rule D120 and migration 261 both
-- state. HQ's user ids and this database's are unrelated number spaces, so an
-- HQ id stored here could be joined to a local `users` row and name the wrong
-- person with complete confidence. Nothing here is joinable.
--
-- `token_hash`, NEVER THE TOKEN, on the `magic_link_tokens` precedent (083) and
-- D120's hand-off store: a read of this table cannot accept an invitation.
--
-- TIMESTAMPS COME FROM SQLITE AND ARE COMPARED AGAINST SQLITE. `datetime('now')`
-- on both sides, never an ISO string against `CURRENT_TIMESTAMP` — D120 records
-- why at length: SQLite compares these as TEXT, and 'T' (0x54) beats ' ' (0x20)
-- at position 10, so an ISO value is always the greater and an expiry written
-- that way does not take effect until the UTC date rolls over.

CREATE TABLE IF NOT EXISTS branch_invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT    NOT NULL UNIQUE,
  -- Normalised (trimmed, lower-cased) before it lands here so the unique index
  -- and the match at accept time agree, exactly as 236 requires.
  email            TEXT    NOT NULL,
  name             TEXT,
  role             TEXT    NOT NULL DEFAULT 'exploring',
  token_hash       TEXT    NOT NULL UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  -- Where this person is arriving FROM, and why. Both are HQ's words, kept so
  -- the destination's admin can see that this is a move rather than a fresh
  -- application — an invitation with no provenance reads as the latter.
  moved_from_code  TEXT,
  reason           TEXT,
  invited_by_name  TEXT    NOT NULL,
  email_sent       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT    NOT NULL,
  accepted_at      TEXT,
  revoked_at       TEXT
);

CREATE INDEX IF NOT EXISTS ix_branch_inv_email  ON branch_invitations(email, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_branch_inv_status ON branch_invitations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_branch_inv_token  ON branch_invitations(token_hash);
