-- D1345 / #3553. The owner chose removal after Email shipped.
-- Read-only production checks on 2026-10-28 found zero rows in all four
-- stores and zero objects under FILES' messages/ prefix (no truncated result).
-- Fail before any DROP if a conversation or attachment arrived meanwhile.
-- This transient assertion table is removed on a successful migration.
CREATE TABLE IF NOT EXISTS d1345_messages_empty_guard (
  row_count INTEGER NOT NULL CHECK (row_count = 0)
);
INSERT INTO d1345_messages_empty_guard (row_count)
SELECT (SELECT COUNT(*) FROM message_attachments)
     + (SELECT COUNT(*) FROM message_thread_participants)
     + (SELECT COUNT(*) FROM messages)
     + (SELECT COUNT(*) FROM message_threads);
DROP TABLE d1345_messages_empty_guard;
DROP TABLE message_attachments;
DROP TABLE message_thread_participants;
DROP TABLE messages;
DROP TABLE message_threads;
