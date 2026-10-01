-- 323_message_attachments.sql — Messages: files attached to a message
-- (D415, wave 8, Session 13).
--
-- The Messages canvas draws a paperclip in the composer and says
-- "Attachments are visible to both parties only". Migration 185 says, of
-- itself, "NOT here: reactions, attachments…", so until now the paperclip had
-- nothing to write to and D414 printed that instead.
--
-- ONE ROW PER FILE, ALWAYS ON A MESSAGE. An attachment is sent the way a
-- message is: it lands in a thread, from a sender, at a time. So each row
-- names its message and its thread. The thread column is redundant with the
-- message's, and is kept because every read of an attachment is scoped by
-- thread membership first.
--
-- THE BYTES ARE IN R2, NOT HERE. `r2_key` points into the FILES bucket under
-- the `messages/` prefix, which nothing else writes. The bucket is private:
-- the only way to the bytes is a signed, single-use, five-minute link
-- (services/signedDownload.ts), minted only for a member of the thread.
--
--   uid                TEXT     — the attachment's public id.
--   thread_id          INTEGER  — the thread it was sent in.
--   message_id         INTEGER  — the message it rides on.
--   uploader_user_id   INTEGER  — who sent it.
--   r2_key             TEXT     — where the bytes are, under messages/.
--   filename           TEXT     — the name as sent, sanitised.
--   content_type       TEXT     — sniffed from the bytes, not the header.
--   size_bytes         INTEGER  — the stored size.
--   sha256             TEXT     — of the stored bytes.
--
-- STANDS ALONE: one new table and its indexes, depending on no other wave-8
-- migration. IDEMPOTENT (CREATE … IF NOT EXISTS). Apply through the
-- ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS message_attachments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    uid               TEXT    NOT NULL UNIQUE,
    thread_id         INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    message_id        INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    uploader_user_id  INTEGER NOT NULL REFERENCES users(id),
    r2_key            TEXT    NOT NULL UNIQUE CHECK (r2_key LIKE 'messages/%'),
    filename          TEXT    NOT NULL,
    content_type      TEXT    NOT NULL,
    size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0),
    sha256            TEXT    NOT NULL,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_thread ON message_attachments(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_uploader ON message_attachments(uploader_user_id, created_at);
