-- D686 / #1592: the time a connected tool last entered its error state.
ALTER TABLE integrations ADD COLUMN last_error_at TEXT;
