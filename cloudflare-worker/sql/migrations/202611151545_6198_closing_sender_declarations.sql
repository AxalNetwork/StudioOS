-- D6198 (#6198): an investor's own declaration that they sent their money.
--
-- A sender's declaration reads "Sent, not yet confirmed" on the investor's
-- closing line and never "Received": only the receiving side's evidence
-- (`closing_evidence.side = 'receiving'`) turns a line received. It is its own
-- table because `closing_evidence.kind` is a CHECK list (612), and a
-- declaration is the investor's word, not a stored record.
--
-- No bank memo or account number is kept: `reference` is an optional short
-- label the investor chooses, and the Worker refuses one that looks like an
-- account number. One active declaration per line; a withdrawn one stays as
-- history.
CREATE TABLE IF NOT EXISTS closing_sender_declarations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  line_id       INTEGER NOT NULL REFERENCES closing_lines(id),
  declared_by   INTEGER NOT NULL REFERENCES users(id),
  sent_on       TEXT NOT NULL CHECK (sent_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  amount_cents  INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  reference     TEXT CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 40),
  withdrawn_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_closing_sender_declarations_active
  ON closing_sender_declarations (line_id) WHERE withdrawn_at IS NULL;
