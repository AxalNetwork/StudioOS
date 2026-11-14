-- Pitch Deck Reviewer feature — canonical D1 schema.
-- Apply via:
--   npx wrangler d1 execute studioos-db --config ../wrangler.toml --remote \
--     --file=cloudflare-worker/sql/deck_reviews.sql
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS). Mirrored at runtime by
-- cloudflare-worker/src/services/deckReviewSchema.ts.

-- One row per uploaded/pasted deck. Raw bytes live in R2 (r2_key); the app
-- never serves them publicly. `raw_retained` tracks the retention lifecycle —
-- the raw file can be purged after processing (DELETE /:id/raw) while the
-- extracted sections + review are retained.
CREATE TABLE IF NOT EXISTS deck_reviews (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER,
    source TEXT NOT NULL DEFAULT 'upload',       -- upload | paste
    filename TEXT,
    mime TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT,
    raw_retained INTEGER NOT NULL DEFAULT 0,
    extraction_status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | empty | failed
    chunks_json TEXT NOT NULL DEFAULT '[]',
    sections_json TEXT NOT NULL DEFAULT '[]',
    review_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',         -- draft | processing | complete | needs_manual
    title TEXT,
    edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_reviews_user ON deck_reviews (user_id, updated_at);

-- Append-only history of generated reviews (compare regenerations).
CREATE TABLE IF NOT EXISTS deck_review_history (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES deck_reviews(id) ON DELETE CASCADE,
    review_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_review_history_review ON deck_review_history (review_id, created_at);
