-- 449 — D684: interview channels (#1575). A founder connects their BUSINESS
-- Telegram or WhatsApp account, or schedules a Zoom or Google Meet call, and the
-- conversation reaches Validate › Interviews through one intake.
--
-- WHO OWNS WHAT
--   A connection is an ordinary `integrations` row, one per member and provider:
--     telegram — the Axal bot connected to the member's Telegram Business
--                account. external_account_id = their Telegram user id (proved
--                by a one-time link code), config_json holds the business
--                connection id and its rights. No credentials: the bot token is
--                a platform Worker secret.
--     whatsapp — the member's own business number, onboarded through Meta
--                Embedded Signup (coexistence keeps their WhatsApp Business
--                app working). external_account_id = the phone_number_id,
--                credentials_enc = the business token (columnCipher, KEK_PII).
--     zoom     — OAuth per member, through the Connectors registry.
--   Google Meet rides on the member's existing Google Calendar connection.
--
-- WHERE TEXT LIVES
--   A customer conversation is a thread. Until the member assigns it to an
--   interview it is PENDING, and its messages wait in channel_thread_messages,
--   encrypted (columnCipher, AAD table:column:uid), for at most 30 days. On
--   assignment they move into interview_transcript_segments — where every
--   transcript already lives — and the pending copies are deleted. Messages on
--   an assigned thread go straight to the interview's session. Nothing else
--   here holds text.
--
-- TABLES
--   channel_link_codes      One-time codes that prove a Telegram account is the
--                           member's (/start <code>). SHA-256 only; ten minutes;
--                           once.
--   telegram_business_connections
--                           Each Bot API business_connection, by its id, with the
--                           Telegram user who made it. user_id is filled once that
--                           Telegram user has linked; until then it is NULL and
--                           nothing from the connection is stored.
--   channel_threads         One customer conversation per connection and chat.
--   channel_thread_messages Pending messages only (see above).
--   channel_events          Every webhook event once: UNIQUE(provider,
--                           external_event_id) is the idempotency boundary for all
--                           four providers. Ids and outcome, never text.
--
-- Every provider event or message id here (external_event_id, and
-- external_message_id in channel_outbound and channel_thread_messages) is a
-- SHA-256 of provider:id, never the id: a WhatsApp wamid carries the customer's
-- number in base64, and these columns are only ever compared for equality.
--   channel_outbound        Every message Axal sends on a member's behalf.
--                           `client_key` UNIQUE makes a retried send a no-op;
--                           `status` keeps the provider accepting a send
--                           ('submitted') apart from WhatsApp reporting it
--                           'delivered' or 'read' — Telegram reports acceptance only.
--   interview_channel_refs  A Zoom or Meet call an interview scheduled, tied to
--                           the session its transcript becomes.
--
-- The partial unique index lets one Telegram account or one WhatsApp number
-- belong to one Axal member at a time; disconnecting frees it.

CREATE TABLE IF NOT EXISTS channel_link_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_user ON channel_link_codes(user_id, provider, created_at);

CREATE TABLE IF NOT EXISTS telegram_business_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  business_connection_id TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  can_reply INTEGER NOT NULL DEFAULT 0,
  rights_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tg_business_connections_tg_user ON telegram_business_connections(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tg_business_connections_user ON telegram_business_connections(user_id);

CREATE TABLE IF NOT EXISTS channel_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'whatsapp')),
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_chat_id TEXT NOT NULL,
  contact_name_enc TEXT,
  interview_id INTEGER,
  session_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'ignored')),
  message_count INTEGER NOT NULL DEFAULT 0,
  last_inbound_at TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, external_chat_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_threads_user ON channel_threads(user_id, status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_channel_threads_interview ON channel_threads(interview_id);

CREATE TABLE IF NOT EXISTS channel_thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  thread_id INTEGER NOT NULL REFERENCES channel_threads(id) ON DELETE CASCADE,
  external_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice')),
  text_enc TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (thread_id, external_message_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_thread_messages_thread ON channel_thread_messages(thread_id, sent_at, id);

CREATE TABLE IF NOT EXISTS channel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'whatsapp', 'zoom', 'google_meet')),
  external_event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'voice', 'echo', 'edit', 'delete', 'command', 'link', 'connection', 'status', 'meeting', 'transcript', 'ignored')),
  user_id INTEGER,
  thread_id INTEGER,
  session_id INTEGER,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'stored', 'done', 'ignored', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_events_user ON channel_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS channel_outbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'whatsapp')),
  user_id INTEGER NOT NULL,
  thread_id INTEGER REFERENCES channel_threads(id) ON DELETE SET NULL,
  client_key TEXT NOT NULL UNIQUE,
  external_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'delivered', 'read', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_outbound_external ON channel_outbound(provider, external_message_id);

CREATE TABLE IF NOT EXISTS interview_channel_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('zoom', 'google_meet')),
  external_ref TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  interview_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  join_url TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'ended', 'transcript_ready', 'imported', 'no_transcript', 'failed', 'cancelled')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_ref)
);
CREATE INDEX IF NOT EXISTS idx_interview_channel_refs_interview ON interview_channel_refs(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_channel_refs_due ON interview_channel_refs(provider, status, ends_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_channel_identity
  ON integrations(provider_key, external_account_id)
  WHERE provider_key IN ('telegram', 'whatsapp') AND external_account_id IS NOT NULL AND status = 'active';
