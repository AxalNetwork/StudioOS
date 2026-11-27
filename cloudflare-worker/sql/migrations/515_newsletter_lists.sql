-- 515 — newsletter lists: topics, subscribers and their choices, and the
-- suppression list every sender checks (D810, #2256; part of D809, #2255).
--
-- `newsletter_topics` is the closed list of what a person can subscribe to.
-- `partner_letter` is for investors and LPs only (`audience = 'investors'`):
-- the website's signup never offers it, and only a signed-in investor or LP
-- can turn it on.
--
-- `newsletter_subscribers` is one row per address, lowercased. A website
-- signup is `pending` until its confirmation link is used (double opt-in);
-- only the SHA-256 of that single-use token is kept, with its expiry (48 h).
-- `consent_text_version` and `consented_at` record what the person agreed to
-- and when; `ip_hash` is a salted SHA-256 of the address the signup came
-- from, never the address itself. `token_version` signs the long-lived
-- preferences and unsubscribe links: raising it retires every link already
-- sent. `last_email_at` paces the emails a signup can trigger.
--
-- `newsletter_subscriber_topics` is each subscriber's choice per topic.
--
-- `email_suppressions` is one row per address and reason. What it blocks
-- depends on the reason (D810 §4): an unsubscribe blocks newsletter and
-- marketing mail; a bounce or complaint blocks all mail but account security
-- (sign-in links, email verification, password resets).
--
-- The backfill folds `insight_subscriptions` into the `insights` topic: each
-- member who has the weekly insights toggle on becomes a confirmed subscriber
-- with that topic on, sourced `account`. The old table stays; its routes keep
-- answering, writing both, until the UI moves (D813).
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS newsletter_topics (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'investors')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO newsletter_topics (key, label, description, audience, sort_order) VALUES
  ('brief', 'The Axal VC Brief', 'The studio''s regular letter: what we built, backed and learned.', 'public', 10),
  ('portfolio', 'Portfolio news', 'Launches, rounds and milestones from the companies we back.', 'public', 20),
  ('founder_calls', 'Founder calls', 'Open calls for founders: programmes, spin-outs and cohorts.', 'public', 30),
  ('events', 'Events', 'Demo days, office hours and gatherings.', 'public', 40),
  ('insights', 'Insights', 'Market readings and benchmarks from the studio''s research.', 'public', 50),
  ('announcements', 'Announcements', 'News about Axal VC and StudioOS.', 'public', 60),
  ('partner_letter', 'Partner letter', 'The letter to our investors and LPs.', 'investors', 70),
  ('testing_calls', 'Testing calls', 'Invitations to try products before they launch.', 'public', 80);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  confirm_token_hash TEXT,
  confirm_expires_at TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'account', 'import')),
  consent_text_version TEXT,
  consented_at TEXT,
  ip_hash TEXT,
  last_email_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_user ON newsletter_subscribers(user_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_confirm ON newsletter_subscribers(confirm_token_hash);

CREATE TABLE IF NOT EXISTS newsletter_subscriber_topics (
  subscriber_id INTEGER NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  topic TEXT NOT NULL REFERENCES newsletter_topics(key),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subscriber_id, topic)
);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (email, reason)
);

-- The backfill: the weekly insights toggle becomes the `insights` topic.
INSERT OR IGNORE INTO newsletter_subscribers
  (uid, email, user_id, status, source, consent_text_version, consented_at, confirmed_at, created_at)
SELECT lower(hex(randomblob(16))), lower(trim(u.email)), u.id, 'confirmed', 'account',
       'insight_subscriptions', s.created_at, s.created_at, s.created_at
  FROM insight_subscriptions s
  JOIN users u ON u.id = s.user_id
 WHERE s.is_subscribed = 1 AND u.email IS NOT NULL AND trim(u.email) <> '';

INSERT OR IGNORE INTO newsletter_subscriber_topics (subscriber_id, topic, enabled, updated_at)
SELECT ns.id, 'insights', 1, s.updated_at
  FROM insight_subscriptions s
  JOIN users u ON u.id = s.user_id
  JOIN newsletter_subscribers ns ON ns.email = lower(trim(u.email))
 WHERE s.is_subscribed = 1;
