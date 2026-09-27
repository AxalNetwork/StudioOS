-- 309_cofounder_agreement_parties.sql — Co-founder Agreement: who the parties
-- to a generated draft are, and each party's own position on each clause
-- (D354, wave 8, Session 7 item 5).
--
-- The Co-founder Agreement canvas draws, per clause, "Accept" / "Needs
-- alignment" with a note, and an execution console with a row per signer.
-- Nothing stored either: `documents` has one `signed_by` per DOCUMENT, and no
-- table recorded who a draft's parties are, so a clause reading "Accepted" had
-- nothing behind it.
--
-- cofounder_agreement_parties — one row per founder named in the generator's
--   request, written when POST /api/legal/cofounder-agreement creates the
--   draft. `user_id` is the account whose email matches the party's email at
--   generation time (LOWER(email) equality, the D410 rule); NULL when the
--   party gave no email or has no account, and such a party can record
--   nothing — a position needs a signed-in account behind it.
--
-- cofounder_clause_positions — one row per (draft, clause, party account).
--   `user_id` is ALWAYS the signed-in caller's own id: the route never reads a
--   user id from the request, and refuses a request that names one other than
--   the caller's (`party_mismatch`). UNIQUE(document_id, clause_key, user_id)
--   means a party can only ever change their own row; there is no column
--   through which one party's write could land on another's.
--
-- STANDS ALONE: `documents` and `users` are baseline tables; no other wave-8
-- migration is needed. CREATE … IF NOT EXISTS only, no BEGIN/COMMIT (D1
-- rejects them). Apply with the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS cofounder_agreement_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  party_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, party_index)
);

CREATE INDEX IF NOT EXISTS idx_cofounder_agreement_parties_user
  ON cofounder_agreement_parties (user_id);

CREATE TABLE IF NOT EXISTS cofounder_clause_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  clause_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  position TEXT NOT NULL CHECK (position IN ('accepted', 'needs_alignment')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, clause_key, user_id)
);
