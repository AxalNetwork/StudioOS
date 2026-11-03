-- #4176 (D4176, part 1 of #3726): Learning video on Cloudflare Stream.
--
-- SQLite cannot widen learning_items.video_source's CHECK without a table
-- rebuild, so Stream sits BESIDE the item: `stream_uid` names the ready Stream
-- video the item plays (null = none). Playback precedence is a ready Stream
-- video, then the R2 upload (D561), then the link. A PATCH that sets
-- video_url clears stream_uid ("a link replaces an upload").
--
-- chapters_json: [{ start_seconds, title }], at most 100, strictly increasing,
-- validated by PATCH /api/admin/learning/items/:uid.

ALTER TABLE learning_items ADD COLUMN stream_uid TEXT;
ALTER TABLE learning_items ADD COLUMN chapters_json TEXT NOT NULL DEFAULT '[]';

-- One row per Stream video made for an item. `origin` r2_copy is part 4's.
CREATE TABLE IF NOT EXISTS learning_stream_videos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_uid          TEXT NOT NULL,
  stream_uid        TEXT NOT NULL UNIQUE,
  origin            TEXT NOT NULL CHECK (origin IN ('upload', 'r2_copy')),
  state             TEXT NOT NULL DEFAULT 'awaiting_upload'
                    CHECK (state IN ('awaiting_upload', 'processing', 'ready', 'error', 'superseded')),
  error_code        TEXT,
  error_message     TEXT,
  duration_seconds  INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  size_bytes        INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  width             INTEGER,
  height            INTEGER,
  playback_host     TEXT,
  thumbnail_pct     REAL CHECK (thumbnail_pct IS NULL OR (thumbnail_pct >= 0 AND thumbnail_pct <= 1)),
  source_r2_key     TEXT,
  verified_at       TEXT,
  upload_expires_at TEXT,
  created_by        INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_stream_videos_item ON learning_stream_videos(item_uid, state);

CREATE TABLE IF NOT EXISTS learning_stream_captions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_video_id INTEGER NOT NULL REFERENCES learning_stream_videos(id),
  language        TEXT NOT NULL,
  label           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('generated', 'uploaded')),
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'error')),
  created_by      INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (stream_video_id, language)
);
