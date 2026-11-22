-- D5829 (#5829): private, explicitly reviewed survey evidence. Expand only.
ALTER TABLE typeform_answers ADD COLUMN mapping_signature TEXT;
ALTER TABLE demand_signals ADD COLUMN source_typeform_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_demand_typeform_source ON demand_signals(project_id, source_typeform_key);

CREATE TABLE IF NOT EXISTS typeform_evidence_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  field_mapping_id INTEGER NOT NULL,
  mapping_signature TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  experiment_id INTEGER,
  direction TEXT NOT NULL CHECK(direction IN ('supports', 'contradicts')),
  strength TEXT CHECK(strength IS NULL OR strength IN ('anecdote', 'pattern', 'measured')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(field_mapping_id, version)
);
CREATE INDEX IF NOT EXISTS idx_typeform_evidence_scope ON typeform_evidence_mappings(project_id, integration_id);

-- No answer FK: removal keeps the source tombstone, without the answer text.
CREATE TABLE IF NOT EXISTS typeform_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  evidence_mapping_id INTEGER NOT NULL,
  mapping_version INTEGER NOT NULL,
  answer_id INTEGER,
  signal_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'dismissed', 'withdrawn', 'unlinked')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  UNIQUE(project_id, integration_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_typeform_reviews_answer ON typeform_reviews(answer_id);
CREATE INDEX IF NOT EXISTS idx_typeform_reviews_signal ON typeform_reviews(signal_id);

-- A stale preflight read cannot confirm a withdrawn answer or a superseded target.
CREATE TRIGGER IF NOT EXISTS typeform_review_confirmation_guard
BEFORE UPDATE OF status ON typeform_reviews WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'typeform_reviews.status: source or mapping is no longer reviewable') WHERE OLD.status <> 'pending' OR NOT EXISTS (
    SELECT 1 FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id
      JOIN typeform_form_syncs s ON s.id = r.sync_id JOIN typeform_field_mappings f ON f.id = a.mapping_id
      JOIN typeform_evidence_mappings e ON e.id = NEW.evidence_mapping_id
      JOIN hypotheses h ON h.id = e.hypothesis_id
      JOIN demand_signals d ON d.id = NEW.signal_id
    WHERE a.id = NEW.answer_id AND r.status = 'active' AND r.response_type = 'completed'
      AND s.status = 'active' AND f.status = 'active' AND s.project_id = NEW.project_id AND s.integration_id = NEW.integration_id
      AND e.project_id = s.project_id AND e.integration_id = s.integration_id AND h.project_id = s.project_id
      AND d.project_id = s.project_id AND d.source_kind = 'typeform' AND d.source_typeform_key = NEW.source_key
      AND e.field_mapping_id = f.id AND e.mapping_signature = a.mapping_signature AND e.version = NEW.mapping_version
      AND e.version = (SELECT MAX(v.version) FROM typeform_evidence_mappings v WHERE v.field_mapping_id = f.id)
  );
END;
