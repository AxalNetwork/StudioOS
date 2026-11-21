-- D6011 (#6011): market figures carry a source, a date and a history.
--
-- `projects.tam/.sam/.som` are bare REALs: they say what a figure is, never
-- where it came from, when it was set or what it was before. This table is the
-- record of each change. It is APPEND-ONLY: a change is a new row, and the
-- latest row per (project, figure) is the current one. `projects.tam/.sam/.som`
-- stay the copy every other surface reads, and the writer keeps the two in step.
--
-- `value` is NULL when a figure was cleared. `method` says how the figure was
-- reached: typed straight in, derived top-down or bottom-up on the sizing page,
-- or drawn from a document. `source_title` and `source_url` are COPIED from
-- the venture's `market_sources` row when the founder names one, so the history
-- still names it after the source row is removed (`market_source_id` then goes
-- NULL). A row with no source says so; nothing here is guessed.
--
-- A figure saved before this table existed has no row: the reader falls back
-- to `projects.*` and says "No source recorded".
--
-- No BEGIN/COMMIT: D1's HTTP API rejects transaction statements inside a
-- migration file.
CREATE TABLE IF NOT EXISTS market_figures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  figure TEXT NOT NULL CHECK (figure IN ('tam', 'sam', 'som')),
  value REAL CHECK (value IS NULL OR value >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  method TEXT NOT NULL DEFAULT 'typed' CHECK (method IN ('typed', 'top_down', 'bottom_up', 'document')),
  source_title TEXT,
  source_url TEXT,
  market_source_id INTEGER REFERENCES market_sources(id) ON DELETE SET NULL,
  set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  set_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_figures_latest
  ON market_figures (project_id, figure, id);

-- A row is never rewritten. Only the two references may go NULL, when the
-- source row or the user it points at is deleted. A project's hard delete
-- still removes its rows (the cascade above), so there is no delete trigger.
CREATE TRIGGER IF NOT EXISTS market_figures_append_only
BEFORE UPDATE ON market_figures
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.figure IS NOT OLD.figure
  OR NEW.value IS NOT OLD.value OR NEW.currency IS NOT OLD.currency
  OR NEW.method IS NOT OLD.method OR NEW.source_title IS NOT OLD.source_title
  OR NEW.source_url IS NOT OLD.source_url OR NEW.set_at IS NOT OLD.set_at
  OR (NEW.market_source_id IS NOT NULL AND NEW.market_source_id IS NOT OLD.market_source_id)
  OR (NEW.set_by IS NOT NULL AND NEW.set_by IS NOT OLD.set_by)
BEGIN
  SELECT RAISE(ABORT, 'market_figures is append-only (D6011).');
END;
