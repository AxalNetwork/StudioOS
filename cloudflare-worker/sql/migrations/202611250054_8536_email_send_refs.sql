-- D8536 (#8536) — the send reference ledger for transactional email.
--
-- One row per send reference: the flow, the subject record the email is about
-- and the attempt (one issuance of that record's link). A retry of the same
-- reference reads this row first, so a send the provider already accepted, or
-- one whose request left and never answered (`timed_out`), is reconciled
-- instead of sent twice. `services/email/deliveryContract.ts` owns it.
--
-- No address and no link is stored here. The recipient is the address the
-- subject record names, read from that record at send time; the link lives
-- only in the message.
CREATE TABLE IF NOT EXISTS email_send_refs (
  ref TEXT PRIMARY KEY,
  flow TEXT NOT NULL CHECK (flow IN ('sign_in', 'invitation', 'billing', 'signature', 'alert')),
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  attempt TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'accepted', 'refused', 'timed_out', 'delivered', 'bounced')),
  tries INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_send_refs_subject ON email_send_refs (subject_kind, subject_id);
