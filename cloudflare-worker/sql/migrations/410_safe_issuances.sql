-- 410 — safe_issuances: the SAFEs a startup issues in its round, one row per
-- investor (D578, #1205; S1's decisions Q1 A and Q2 A for the owner).
--
--   form                'post_money_cap': a post-money SAFE with a valuation cap
--                       and no discount (Q1 A). The CHECK holds it to that form
--                       until a decision adds another.
--   amount_cents        the investor's purchase amount, integer cents.
--   valuation_cap_cents the post-money valuation cap, integer cents.
--   prospect_id         the round's prospect it was drafted for, when there is one
--                       (`raise_prospects`); investor_name is the name on the SAFE.
--   envelope_id         the e-sign envelope it was sent in. NULL means not sent:
--                       the status a screen shows ("Sent", "Countersigned") is
--                       read from that envelope and nowhere else.
--
-- Nothing can be sent yet. The SAFE text is the owner's to supply with counsel's
-- sign-off (#1205, answer A); until it is registered in services/legalTemplates.ts
-- the send route refuses, and `esignOriginators.ts` keeps SAFE as NO_BODY.
--
-- Additive and idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS safe_issuances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  prospect_id         INTEGER REFERENCES raise_prospects(id),
  investor_name       TEXT NOT NULL CHECK (length(trim(investor_name)) > 0),
  form                TEXT NOT NULL DEFAULT 'post_money_cap' CHECK (form = 'post_money_cap'),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  valuation_cap_cents INTEGER NOT NULL CHECK (valuation_cap_cents > 0),
  currency            TEXT NOT NULL DEFAULT 'usd',
  envelope_id         INTEGER REFERENCES esign_envelopes(id),
  created_by          INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_safe_issuances_project ON safe_issuances (project_id, id);
