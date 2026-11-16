-- D6316: short-lived pipeline membership and immutable keysets; no copied contact content.
CREATE TABLE grow_prospect_pages (
  uid TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  campaign TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX grow_prospect_pages_expiry ON grow_prospect_pages(expires_at);
CREATE TABLE grow_prospect_page_items (
  page_uid TEXT NOT NULL REFERENCES grow_prospect_pages(uid) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  sort_at TEXT NOT NULL,
  PRIMARY KEY(page_uid,contact_id)
);
CREATE INDEX grow_prospect_page_items_keyset ON grow_prospect_page_items(page_uid,status,sort_at DESC,contact_id DESC);
