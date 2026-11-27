-- Task #14: Forward-log table for signed eSign envelopes.
-- Every "Forward to legal partner" delivery is logged here for audit.

CREATE TABLE IF NOT EXISTS esign_forward_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id INTEGER NOT NULL,
  forwarded_by INTEGER NOT NULL,
  forwarded_to TEXT NOT NULL,
  forwarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  include_audit_page INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  email_sent INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_esign_forward_envelope ON esign_forward_log(envelope_id, forwarded_at);
CREATE INDEX IF NOT EXISTS idx_esign_forward_to ON esign_forward_log(forwarded_to);
