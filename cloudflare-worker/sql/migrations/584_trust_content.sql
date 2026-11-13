-- 584 — The public trust center's content store and change log, its
-- subprocessors and their notices, and members' security reports (D1075,
-- #2967, part 3 of #2425).
--
-- WHAT HQ PUBLISHES ON /trust. D1072 drew the public trust center from facts
-- the code shows, each "Checked: Not recorded". This store gives each of the
-- canvas's seven blocks (TRU14: At a glance, Security, Data and privacy,
-- Subprocessors, Certifications, Documents, Disclosure) a draft and a
-- published copy. Visitors read only the published one. A Super Admin saves
-- drafts, then one Publish moves every draft live with ONE change note, which
-- the change log keeps for good.
--
-- THE NOTE IS REQUIRED, AT THE ROW AS WELL AS IN THE ROUTE. A published block
-- without its note, date and publisher cannot be written (the CHECK below);
-- the route refuses first, with a sentence.
--
-- THE CHANGE LOG IS APPEND-ONLY. "Changes to this page" is a public record:
-- the triggers refuse an UPDATE or DELETE, as `licence_events` does (D156).
--
-- A CERTIFICATION NEEDS ITS REPORT. The Certifications block names each
-- certification's auditor's report by uid; `services/trustContent.ts`
-- refuses an item whose report is not in `trust_certification_reports`. The
-- file itself is in R2 (FILES), never in D1.
--
-- SUBPROCESSORS ARE ROWS, NOT BLOCK TEXT, because each one carries its own
-- start date and its own notice. A new one is a draft until Publish, and
-- starts no sooner than ten days after it (the draft DPA's promise,
-- `templates/legal/dpa_v1.md`). Its notice goes to confirmed subscribers
-- only, once each (`subprocessor_notice_deliveries`).
--
-- A SUBSCRIBER'S ADDRESS IS ENCRYPTED. The notice has to reach the address, so
-- it is kept, as AES-GCM ciphertext bound to the row (`services/columnCipher.ts`),
-- with an HMAC of it for the one-row-per-address lookup. The confirm token is
-- stored only as a hash; the unsubscribe link is signed, never stored.
--
-- SECURITY REPORTS ARE THEIR OWN STORE, NOT A TICKET CATEGORY ROW. A ticket is
-- mirrored to GitHub issues on a public repository, posted to Slack, and read
-- by every admin across about fifteen queries; `tickets.category` also has a
-- CHECK naming eight categories, so adding a ninth is a table rebuild. A
-- security report is read by HQ's Super Admins and the person who sent it,
-- and nothing else. What was found and how to reproduce it are encrypted.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote

CREATE TABLE IF NOT EXISTS trust_content_blocks (
    key           TEXT NOT NULL
                  CHECK (key IN ('glance', 'security', 'data', 'subprocessors', 'certifications', 'documents', 'disclosure')),
    state         TEXT NOT NULL CHECK (state IN ('draft', 'published')),
    body_json     TEXT NOT NULL CHECK (json_valid(body_json)),
    -- The day the block's facts were last checked. NULL reads "Checked: Not recorded".
    checked_at    TEXT CHECK (checked_at IS NULL OR checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    published_at  TEXT,
    published_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    change_note   TEXT,
    change_uid    TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (key, state),
    CHECK (state = 'draft' OR (
        published_at IS NOT NULL AND change_uid IS NOT NULL
        AND change_note IS NOT NULL AND length(trim(change_note)) >= 10
    ))
);

CREATE TABLE IF NOT EXISTS trust_content_changes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                TEXT NOT NULL UNIQUE,
    published_at       TEXT NOT NULL DEFAULT (datetime('now')),
    published_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    change_note        TEXT NOT NULL CHECK (length(trim(change_note)) BETWEEN 10 AND 1000),
    -- The block keys this publish changed, and the subprocessors it added or removed.
    blocks_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocks_json)),
    subprocessors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subprocessors_json))
);

CREATE INDEX IF NOT EXISTS idx_trust_content_changes_published ON trust_content_changes(published_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trust_content_changes_block_update
BEFORE UPDATE ON trust_content_changes
BEGIN
    SELECT RAISE(ABORT,
        'trust_content_changes is append-only (D1075). A published change is on the public record; publish a correcting change instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS trust_content_changes_block_delete
BEFORE DELETE ON trust_content_changes
BEGIN
    SELECT RAISE(ABORT,
        'trust_content_changes is append-only (D1075). Deleting a change would remove it from the public record.'
    );
END;

CREATE TABLE IF NOT EXISTS trust_certification_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT NOT NULL UNIQUE,
    r2_key        TEXT NOT NULL UNIQUE,
    sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
    size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
    content_type  TEXT NOT NULL CHECK (content_type = 'application/pdf'),
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trust_subprocessors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    purpose       TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 300),
    data_seen     TEXT NOT NULL CHECK (length(trim(data_seen)) BETWEEN 1 AND 300),
    location      TEXT NOT NULL CHECK (length(trim(location)) BETWEEN 1 AND 120),
    -- draft: not public. published: listed (from starts_at). removing: listed,
    -- and taken off at the next Publish. removed: taken off.
    state         TEXT NOT NULL CHECK (state IN ('draft', 'published', 'removing', 'removed')),
    -- The day it starts processing. Set at Publish to no sooner than ten days after it.
    starts_at     TEXT CHECK (starts_at IS NULL OR starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    published_at  TEXT,
    removed_at    TEXT,
    change_uid    TEXT,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (state = 'draft' OR (published_at IS NOT NULL AND starts_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_trust_subprocessors_state ON trust_subprocessors(state, starts_at);

CREATE TABLE IF NOT EXISTS subprocessor_subscribers (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                     TEXT NOT NULL UNIQUE,
    email_hash              TEXT NOT NULL UNIQUE,
    email_enc               TEXT NOT NULL,
    status                  TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
    confirm_token_hash      TEXT UNIQUE,
    confirm_expires_at      TEXT,
    -- The unsubscribe link is signed over (uid, token_version); using it bumps
    -- the version, so each link works once.
    token_version           INTEGER NOT NULL DEFAULT 1 CHECK (token_version >= 1),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at            TEXT,
    unsubscribed_at         TEXT,
    last_email_at           TEXT,
    CHECK (status != 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_subprocessor_subscribers_status ON subprocessor_subscribers(status);

CREATE TABLE IF NOT EXISTS subprocessor_notice_deliveries (
    subprocessor_id  INTEGER NOT NULL REFERENCES trust_subprocessors(id) ON DELETE CASCADE,
    subscriber_id    INTEGER NOT NULL REFERENCES subprocessor_subscribers(id) ON DELETE CASCADE,
    outcome          TEXT NOT NULL CHECK (outcome IN ('sending', 'sent', 'failed')),
    attempted_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (subprocessor_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS security_reports (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                 TEXT NOT NULL UNIQUE,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The page or feature named; not secret, so the list can show it.
    affected            TEXT NOT NULL CHECK (length(trim(affected)) BETWEEN 1 AND 200),
    -- What happened, and how to reproduce it: ciphertext (columnCipher).
    what_enc            TEXT NOT NULL,
    how_enc             TEXT,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_at     TEXT,
    resolved_at         TEXT,
    answered_by         INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_reports_status ON security_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_security_reports_user ON security_reports(user_id, created_at);
