-- 717 — a model pick per deck element (D1503, #3754, deck v2 A10).
-- Number named on #3754 by S1 and checked free on 2026-11-01: 716 and 718
-- are not on main either, and no open pull request uses 717.
--
-- deck_model_picks  one row per scope, scope id and key: the model a grid
-- element (or its group) runs on, read by services/decks/elementModels.ts
-- `resolveElementModel` in its 8 levels.
--   id          row id.
--   scope       'org' (HQ's default, or its lock when `locked` = 1), 'area'
--               (one area's override), 'deck' (the venture's deck, across its
--               versions) or 'member' (one member's own pick).
--   scope_id    the scope's id, as text: 'hq' for the org; the project id for
--               a deck; '<project>/<card>/<area>' for an area; the user id
--               for a member. Never a name or an email.
--   key         an element id ('title', 'photo') or 'group:<group>'
--               ('group:text'). No CHECK list: the element catalogue is
--               `ELEMENTS`, and the route refuses any other key before it
--               writes.
--   model       the catalogue id picked (services/ai/catalogue.ts). Checked
--               against the element's choices at write and again at every
--               read: a pick the catalogue no longer offers reads as none and
--               the read clears it.
--   locked      1 on an HQ row that members may not change (403
--               role_locked); 0 everywhere else.
--   plan_min    the plan the pick needs ('all', 'lowest_paid', 'top_paid'),
--               from MODEL_LOCKS at write; a member on a lower plan reads it
--               as skipped, never as cleared.
--   set_by      the user who wrote the row (NULL once that account goes).
--   updated_at  when it was last written.
--
-- A model choice, like ai_rail_preferences (465): it is not a venture write,
-- so no activity_logs row is written for it. A null model on PUT deletes the
-- row. Retention: kept until changed or cleared. scope_id is text, so no
-- foreign key cascades: a member row outlives a deleted account, holds only
-- a user id and a model id, and is read by that user id alone.
--
-- Additive: CREATE TABLE IF NOT EXISTS and an index only. No BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS deck_model_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('org', 'area', 'deck', 'member')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  model TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  plan_min TEXT,
  set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scope, scope_id, key)
);

CREATE INDEX IF NOT EXISTS idx_deck_model_picks_scope ON deck_model_picks(scope, scope_id);
