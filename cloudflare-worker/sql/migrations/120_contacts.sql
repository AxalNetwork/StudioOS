-- Feature: Contacts — unified inbound relationship hub (founder side).
-- Generalizes landing-page waitlist_signups into a managed CRM: audience-tagged
-- contacts with status pipeline, reply log, and follow-up tasks. Routing on
-- ingest (routed_to) sends customers → discovery, investors → raise, everyone
-- else → network. The worker also creates these tables lazily (contacts.ts
-- ensureSchema); this migration is the canonical record. Idempotent.

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL,
  audience TEXT NOT NULL,                 -- customer|investor|partner|advisor|mentor|cofounder
  routed_to TEXT NOT NULL DEFAULT 'network', -- discovery|raise|network
  name TEXT,
  email TEXT NOT NULL,
  cta TEXT, message TEXT, source TEXT,
  landing_page_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',     -- new|invited|contacted|replied|qualified|active|passed
  promoted_to TEXT,                        -- discovery|raise once promoted
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id, audience);
CREATE INDEX IF NOT EXISTS idx_contacts_status  ON contacts(status);

CREATE TABLE IF NOT EXISTS contact_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  direction TEXT NOT NULL DEFAULT 'inbound', -- inbound|outbound
  body TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_replies_contact ON contact_replies(contact_id);

CREATE TABLE IF NOT EXISTS contact_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_tasks_contact ON contact_tasks(contact_id);
