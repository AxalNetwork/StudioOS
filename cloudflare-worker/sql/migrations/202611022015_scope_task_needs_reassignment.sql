-- D1614 W8 (#3994): a task whose assignee's seat on the Team ended.
--
-- When a member leaves a project's Team (DELETE /api/projects/:id/members/:userId),
-- every open task assigned to them is flagged here, with an `updated` event that
-- says why. Nothing is reassigned automatically: a project editor chooses who
-- takes it, and assigning someone (or no one) clears the flag.
--
-- Additive; no transaction statements (D1 rejects them). Named by its UTC
-- minute (D4106).
ALTER TABLE scope_tasks ADD COLUMN needs_reassignment INTEGER NOT NULL DEFAULT 0 CHECK (needs_reassignment IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_scope_tasks_person_assignee ON scope_tasks(assignee_user_id, status) WHERE assignee_kind = 'person';
