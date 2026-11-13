-- 387 — D553 (#1146): an LP's type, and a log of what was sent to which LP.
--
-- LP TYPE. `limited_partners` carried no type, so the LP register (I6 of
-- `design/incoming/Investor LP Canvas.dc.html`) could neither show nor filter
-- by one. The set is closed, so a filter chip and a stored value can never
-- disagree on spelling. It is NULLABLE and has no default: an LP nobody has
-- typed reads "Not recorded", never a guessed "individual".
--
-- THE COMMS LOG. Nothing recorded what was sent to which LP, and when. A row
-- is the fact that something was sent: the fund, the LP, the kind, the
-- subject, when it was sent, who logged it, and optionally the capital-call
-- line (`capital_calls.id`, one LP's share of a call) it was about. IT STORES
-- NO MESSAGE BODY, on purpose: the message lives wherever it was sent from,
-- and a second copy here would be an LP's correspondence held where nobody
-- reviews its retention. Report packs and their delivery log wait on the
-- owner (#1138) and are not here.
--
-- `logged_by` is the actor, taken from the session by the route, never from
-- the request body.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

ALTER TABLE limited_partners ADD COLUMN lp_type TEXT
  CHECK (lp_type IS NULL OR lp_type IN ('individual', 'family_office', 'institution', 'fund_of_funds', 'corporate'));

CREATE TABLE IF NOT EXISTS fund_lp_communications (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id          INTEGER NOT NULL REFERENCES vc_funds(id),
    lp_id            INTEGER NOT NULL REFERENCES limited_partners(id),
    kind             TEXT NOT NULL CHECK (kind IN ('call_reminder', 'call_notice', 'update', 'other')),
    subject          TEXT NOT NULL,
    sent_at          TEXT NOT NULL,
    logged_by        INTEGER NOT NULL REFERENCES users(id),
    capital_call_id  INTEGER REFERENCES capital_calls(id),
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fund_lp_comms_fund ON fund_lp_communications(fund_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_fund_lp_comms_lp ON fund_lp_communications(lp_id, sent_at);
