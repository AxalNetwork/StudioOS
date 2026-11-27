-- D647: an approved snapshot, never an inference from an active draft.
-- Existing templates remain unpublished until an administrator publishes.
CREATE TABLE IF NOT EXISTS legal_template_publications (
  template_id INTEGER PRIMARY KEY REFERENCES legal_templates(id),
  slug TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  body_md TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by INTEGER NOT NULL REFERENCES users(id)
);
