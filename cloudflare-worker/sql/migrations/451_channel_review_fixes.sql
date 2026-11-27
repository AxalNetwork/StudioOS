-- 451 — D684: the interview-channel review fixes (security review of
-- 2026-10-13). Additive only: three nullable columns on
-- `channel_thread_messages`, two on `channel_link_codes`, and one new table.
-- 449 and 450 are applied and are not edited
-- (`scripts/migration-immutability-gate.mjs`); no CHECK constraint changes, so
-- no table is rebuilt.
--
-- 1. A STRANGER'S VOICE NOTE SPENDS NOTHING. A voice note on a chat the member
--    has not assigned is no longer transcribed on arrival: it waits as a
--    placeholder in `channel_thread_messages` (kind 'voice', `text_enc` '' —
--    no text), and is transcribed once the member assigns the chat. A chat
--    already in an interview is transcribed on arrival, as before.
--      voice_ref_enc   the provider's file ref (Telegram file_id, WhatsApp
--                      media id) and mime, as JSON, encrypted with columnCipher
--                      (AAD `channel_thread_messages:voice_ref_enc:<uid>`).
--                      Non-null means the note still waits for its transcript.
--      duration_sec    the provider's duration, when it gives one.
--      transcribe_job  the one queued job allowed to transcribe it (a random
--                      id the job carries), so two jobs never bill one note
--                      twice. NULL when none is queued.
--    The placeholder is an ordinary pending row: deleted with the chat when it
--    is ignored or disconnected, removed by a deletion at the source, and
--    purged after 30 days like any other.
--
-- 2. COUNTERS THAT CAN COUNT. The per-connection webhook limit was a KV
--    read-modify-write on one key per minute; KV takes one write per key per
--    second, so it could never pass about 60 and the 120-a-minute limit never
--    tripped. `channel_counters` holds it in D1, incremented atomically by an
--    upsert, together with the per-connection daily cap on voice
--    transcriptions. Rows hold an integration id, a window and a count —
--    nothing about a message — and are purged after two days.
--
-- 3. A TELEGRAM LINK NEEDS THE TELEGRAM ACCOUNT'S CONSENT. `/start <code>` no
--    longer links on its own: it records which Telegram account redeemed the
--    code, and the bot asks that account to send /confirm after naming the Axal
--    account it would join. Only then is the account linked and its business
--    connections attached.
--      telegram_user_id  the Telegram account that redeemed the code.
--      confirmed_at      when that account confirmed.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction; each statement stands
-- alone.

ALTER TABLE channel_thread_messages ADD COLUMN voice_ref_enc TEXT;
ALTER TABLE channel_thread_messages ADD COLUMN duration_sec INTEGER;
ALTER TABLE channel_thread_messages ADD COLUMN transcribe_job TEXT;

ALTER TABLE channel_link_codes ADD COLUMN telegram_user_id TEXT;
ALTER TABLE channel_link_codes ADD COLUMN confirmed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_tg_user ON channel_link_codes(telegram_user_id, provider);

CREATE TABLE IF NOT EXISTS channel_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  counter TEXT NOT NULL CHECK (counter IN ('events_minute', 'transcriptions_day')),
  window_start TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, counter, window_start)
);
