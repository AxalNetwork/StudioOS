-- D4493 (#4493): Distribution outreach sequences. A due step becomes a draft the
-- founder presses Send on (owner answer E, D1340); nothing here sends.
-- Email and the founder's own recorded voice note are the offered channels
-- (owner answers D and F). LinkedIn, WhatsApp and Telegram rows are allowed by
-- the schema only so a step can be drawn as blocked with its fixed reason.
CREATE TABLE outreach_sequences (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) = 32),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES grow_campaigns(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outreach_sequences_project ON outreach_sequences(project_id, updated_at);
CREATE TABLE outreach_steps (
  id INTEGER PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  channel TEXT NOT NULL CHECK (channel IN ('email','voice','linkedin','whatsapp','telegram')),
  wait_days INTEGER NOT NULL DEFAULT 0 CHECK (wait_days BETWEEN 0 AND 60),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 200),
  body TEXT CHECK (body IS NULL OR length(body) <= 4000),
  recording_asset TEXT CHECK (recording_asset IS NULL OR recording_asset GLOB 'grow-voice/*'),
  recording_mime TEXT CHECK (recording_mime IS NULL OR recording_mime IN ('audio/webm','audio/ogg','audio/mp4','audio/mpeg')),
  recording_bytes INTEGER CHECK (recording_bytes IS NULL OR recording_bytes > 0),
  recording_seconds INTEGER CHECK (recording_seconds IS NULL OR recording_seconds BETWEEN 1 AND 300),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sequence_id, position)
);
CREATE TABLE outreach_enrolments (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) = 32),
  sequence_id INTEGER NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step >= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','stopped_replied','stopped_optout','done')),
  next_due_at TEXT,
  recipient_tz TEXT CHECK (recipient_tz IS NULL OR length(recipient_tz) BETWEEN 1 AND 64),
  enrolled_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sequence_id, contact_id)
);
CREATE INDEX idx_outreach_enrolments_contact ON outreach_enrolments(contact_id, state);
-- A sequence step's draft carries the voice note it attaches and the opt-out
-- line the send must keep. Both are NULL for every other draft.
ALTER TABLE mail_drafts ADD COLUMN attachment_key TEXT;
ALTER TABLE mail_drafts ADD COLUMN required_line TEXT;
