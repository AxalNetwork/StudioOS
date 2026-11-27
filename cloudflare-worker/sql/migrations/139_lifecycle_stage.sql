-- Founder-facing Startup Lifecycle stage (FOUNDER_UX_AUDIT.md, Critical #1).
-- Migration 139. Applied automatically by scripts/migrate-d1.mjs (numeric order,
-- ledgered in schema_migrations). Additive; seeds NO rows.
--
-- `lifecycle_stage` is a FOUNDER-editable stage
-- (idea|validate|build|launch|grow|raise) kept deliberately SEPARATE from the
-- privileged studio pipeline trio (projects.stage / status / playbook_week),
-- which remain admin/partner-only via the whitelist in routes/projects.ts. It is
-- read/written ONLY through GET|PUT /api/progress/lifecycle/:projectId, whose
-- handler mirrors this shape at runtime (ensureLifecycleColumns) so a cold D1
-- isolate / dev SQLite works before this migration applies.
--
-- `lifecycle_manual_checks` stores a small JSON object of founder check-offs for
-- checklist items that cannot be derived from real data (e.g. "talked to 3
-- potential co-founders"). Derivable items are computed at read time and never
-- stored.
--
-- Bare ALTERs (non-idempotent) are acceptable here: these are genuinely-new
-- columns and the forward-only runner applies each file exactly once.

ALTER TABLE projects ADD COLUMN lifecycle_stage TEXT;
ALTER TABLE projects ADD COLUMN lifecycle_manual_checks TEXT;
