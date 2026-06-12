-- Task #5 — Add views counter to articles for author dashboard.
ALTER TABLE articles ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
