-- Spin-Out Lab Incorporate workspace — per-project formation state (JSON):
-- entity choice + override reason, mock/real payment status, document
-- statuses, filing tracker progress, university-IP checklist. Lazy-ensured
-- in routes/projects.ts (ensureProjectIncMetaColumn) for cold isolates.
ALTER TABLE projects ADD COLUMN incorporation_meta TEXT;
