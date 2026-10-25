-- D895 (#2674): migration 549, assigned by S1; NULL means no view cap.
-- Preserve all token data, telemetry references and the AUTOINCREMENT high-water mark.
CREATE TABLE deck_share_sequence_d895 AS
SELECT seq FROM sqlite_sequence WHERE name = 'pitch_deck_share_tokens';
CREATE TABLE pitch_deck_share_tokens_d895 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 deck_id INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,
 used_at TEXT,
 created_by INTEGER,
 created_at TEXT DEFAULT (datetime('now')),
 view_limit INTEGER DEFAULT 1,
 view_count INTEGER NOT NULL DEFAULT 0,
 last_viewed_at TEXT,
 revoked_at TEXT,
 prospect_id INTEGER REFERENCES raise_prospects(id) ON DELETE SET NULL,
 investor_label TEXT,
 allow_download INTEGER NOT NULL DEFAULT 1 CHECK (allow_download IN (0, 1)),
 allow_forwarding INTEGER NOT NULL DEFAULT 1 CHECK (allow_forwarding IN (0, 1)),
 bound_viewer_hash TEXT
);
INSERT INTO pitch_deck_share_tokens_d895
 (id,deck_id,token_hash,expires_at,used_at,created_by,created_at,view_limit,view_count,last_viewed_at,revoked_at,prospect_id,investor_label,allow_download,allow_forwarding,bound_viewer_hash)
SELECT id,deck_id,token_hash,expires_at,used_at,created_by,created_at,
 CASE WHEN view_limit = 2147483647 THEN NULL ELSE view_limit END,
 view_count,last_viewed_at,revoked_at,prospect_id,investor_label,allow_download,allow_forwarding,bound_viewer_hash
FROM pitch_deck_share_tokens;
DROP TABLE pitch_deck_share_tokens;
ALTER TABLE pitch_deck_share_tokens_d895 RENAME TO pitch_deck_share_tokens;
CREATE INDEX idx_deck_share_hash ON pitch_deck_share_tokens(token_hash);

UPDATE sqlite_sequence
   SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM deck_share_sequence_d895), seq))
 WHERE name = 'pitch_deck_share_tokens';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'pitch_deck_share_tokens', seq FROM deck_share_sequence_d895
 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'pitch_deck_share_tokens');
DROP TABLE deck_share_sequence_d895;
