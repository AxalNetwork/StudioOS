-- Task #9 — Intermediary "exploring" role onboarding.
-- Side table for role-review state. `users` is at D1's ALTER-rewrite column
-- limit (see GOTCHAS.md), so per-user role-review fields live here, keyed by
-- user_id (canonical pattern: user_google_links / user_promotion_consent).
--
-- NOTE: the users.role CHECK relax that admits 'exploring' CANNOT live in a
-- SQL migration (it requires a live-DDL-derived table rebuild; non-idempotent
-- files are recorded-without-running on baselined DBs). It is performed by
-- `rebuildUsersRoleCheckForExploring()` via the `ensureExploringSchema()`
-- lazy bootstrap in the worker.
CREATE TABLE IF NOT EXISTS user_role_review (
    user_id INTEGER PRIMARY KEY,
    -- Persona inferred by the onboarding chatbot / advisor role detector.
    -- A SUGGESTION only — never applied to users.role without admin action.
    suggested_role TEXT,
    -- 1 once an admin has explicitly assigned the final role.
    role_confirmed INTEGER NOT NULL DEFAULT 0,
    -- When the user completed the onboarding chat and entered 'exploring'.
    onboarded_at TEXT,
    -- Binding-agreement e-sign envelope sent by an admin (esign_envelopes.id).
    binding_envelope_id INTEGER,
    binding_document_type TEXT,
    binding_sent_at TEXT,
    -- Final assignment audit trail.
    assigned_role TEXT,
    assigned_by_user_id INTEGER,
    assigned_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_role_review_confirmed
    ON user_role_review(role_confirmed);
