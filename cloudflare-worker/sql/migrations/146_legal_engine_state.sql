-- Task #2 — Legal Engine v1: persist the founder's jurisdiction selection
-- per project. One row per project; the picker on /raise/legal-engine
-- reads/writes it via GET/PUT /api/legal/engine/state and it drives which
-- formation templates the checklist shows. jurisdiction_id values come from
-- the JURISDICTIONS catalog (services/jurisdictionCatalog.ts) and are
-- validated in the route, not by the schema.
CREATE TABLE IF NOT EXISTS legal_engine_state (
  project_id INTEGER PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
