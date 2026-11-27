-- D4492 (#4492): marketing permissions, per-venture HMAC suppression and recipient quiet hours. Nothing sends.
CREATE TABLE contact_marketing_consents (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp','telegram','sms','voice','linkedin')),
  basis TEXT NOT NULL CHECK (basis IN ('opted_in','wrote_first','none')),
  proof TEXT CHECK (proof IS NULL OR length(proof) <= 280),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  CHECK (basis = 'none' OR (proof IS NOT NULL AND length(trim(proof)) > 0)),
  UNIQUE(contact_id, channel)
);
CREATE TABLE venture_suppressions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  address_hash TEXT NOT NULL CHECK (length(address_hash) = 64 AND address_hash NOT GLOB '*[^0-9a-f]*'),
  key_tag TEXT NOT NULL CHECK (length(key_tag) = 64),
  reason TEXT NOT NULL CHECK (reason IN ('manual','opted_out','requested','bounced')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, address_hash)
);
CREATE INDEX idx_venture_suppression_key ON venture_suppressions(project_id,key_tag);
CREATE TABLE venture_outreach_settings (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  quiet_from TEXT NOT NULL CHECK (quiet_from GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(quiet_from,1,2) < '24'),
  quiet_to TEXT NOT NULL CHECK (quiet_to GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(quiet_to,1,2) < '24'),
  tz_mode TEXT NOT NULL DEFAULT 'recipient' CHECK (tz_mode = 'recipient'),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (quiet_from <> quiet_to)
);
