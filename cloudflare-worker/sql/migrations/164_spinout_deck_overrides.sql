-- Spin-Out deck manual overrides — a deck-level edit layer that does NOT
-- rewrite the founder's canonical module data.
--
-- WHY THIS EXISTS. The Spin-Out demo-day deck assembles entirely from live Lab
-- data, and `SpinoutSlideEditor`'s "editable" rows wrote straight back into the
-- `projects` columns behind them. So tightening a sentence for one investor
-- deck silently rewrote `projects.solution` / `projects.problem_statement` —
-- the canonical fields the Solution page, the scoring engine and every other
-- surface read. There was no way to say "this wording is for the deck".
--
-- This table is that layer. Resolution order at render time is
-- manual override > canonical module data > derived placeholder, implemented in
-- services/decks/spinoutDeckOverrides.ts. Nothing here is populated by this
-- migration: with no rows, every deck renders exactly as it does today.
--
-- Scope is deliberately narrow. `field_key` is validated against
-- SPINOUT_OVERRIDABLE_KEYS — narrative wording only. Chart series, funnel
-- counts, cap-table segments and KPI tuples are NOT overridable, because a
-- hand-typed funnel number would let the deck assert a figure the underlying
-- data does not support, which is the exact failure the gaps/DRAFT machinery
-- exists to catch.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote
--
-- This file is idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS), and the
-- worker also self-heals on a cold isolate via
-- ensureSpinoutDeckOverridesSchema(), matching the partnerGuidanceSchema
-- pattern, so a preview D1 that has not been migrated still serves the route.

CREATE TABLE IF NOT EXISTS spinout_deck_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    -- Dotted path into SpinoutDeckData, e.g. 'cover.thesis'. Rows whose key is
    -- no longer in the allowlist are ignored on read rather than deleted, so
    -- renaming a field is reversible.
    field_key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One override per field per project — the upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spinout_deck_overrides_project_key
    ON spinout_deck_overrides(project_id, field_key);
