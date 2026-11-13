-- 448 — D680: the public contact form's submissions, kept in D1 (#1554).
--
-- `POST /api/contact` used to file each submission as a GitHub issue on
-- GITHUB_REPO_OWNER/GITHUB_REPO_NAME, which wrangler.toml sets to
-- AxalNetwork/StudioOS: a PUBLIC repository. The issue carried the sender's
-- name, email, message, IP and user agent, and AGENTS.md forbids personal data
-- on GitHub. None was ever filed (the `contact-form` label does not exist on
-- the repository), and the route no longer calls GitHub at all. A submission is
-- stored here, then emailed to the firm's own mailbox for its intent.
--
-- `uid`        — the reference the route answers with and the email quotes.
-- `kind`       — 'contact' or 'support', as the route has always taken it.
-- `intent`     — 'lab', 'invest', 'advise' or 'licence' (CONTACT_INTENTS in
--                routes/contact.ts); NULL for a submission that named none.
-- `company`, `link` — optional; `link` is an http(s) URL of ≤ 500 characters.
-- `subject`    — as sent, or derived from the intent and the sender.
-- `ip_hash`    — SHA-256 of the UTC day, the worker's secret and the client
--                IP. Never the IP itself: enough to see one source sending
--                many in a day, not enough to name it or follow it across days.
-- `user_agent` — truncated to 200 characters.
-- `notified_at`— when the team's email was sent; NULL when it was not (no mail
--                credentials, or the send failed), so an unsent row can be
--                found and read here.
--
-- Additive and idempotent: CREATE … IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL DEFAULT 'contact',
  intent TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  link TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  notified_at TEXT
);

-- The team reads newest first; abuse is looked up by source and day.
CREATE INDEX IF NOT EXISTS idx_contact_submissions_created
  ON contact_submissions (created_at);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_ip_hash
  ON contact_submissions (ip_hash, created_at);
