-- D4294 (#4294, D4289 P5): influencer payout readiness.
--
-- influencer_tax_forms: each W-9 or W-8BEN an influencer uploads. The file
--   is in the private FILES bucket under taxforms/<user_id>/; r2_key is never
--   served to the member or to an admin who is not the Super Admin. The
--   newest row is the form's status (no row reads "missing"); an earlier row
--   stays as the record of what was reviewed. HQ's decision (accepted or
--   rejected, with a reason for a rejection) is written on the row and in
--   the admin audit log.
CREATE TABLE IF NOT EXISTS influencer_tax_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL CHECK (form_type IN ('w9', 'w8ben')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected')),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_reason TEXT,
  CHECK (status = 'submitted' OR decided_at IS NOT NULL),
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_influencer_tax_forms_user ON influencer_tax_forms(user_id, id);
CREATE INDEX IF NOT EXISTS idx_influencer_tax_forms_status ON influencer_tax_forms(status, submitted_at);

-- influencer_terms_acceptances: which version of the Influencer terms each
--   influencer accepted, and when. A payout needs the current version
--   (services/influencer/payoutReadiness.ts INFLUENCER_TERMS_VERSION); a new
--   version is accepted again before the next payout. Append-only by use.
CREATE TABLE IF NOT EXISTS influencer_terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, version)
);
