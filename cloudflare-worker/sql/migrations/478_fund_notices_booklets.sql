-- 478_fund_notices_booklets.sql — D716 (#1781): the Fund's notices and the
-- Subscription Booklet.
--
-- Adds the stores that the two new document kinds (`notice`, `booklet`, in
-- services/legalDocFormat.ts) write:
--
--   legal_notices               one row per issued notice: what was asked of
--                               whom, into which account, frozen. Append-only;
--                               a corrected notice is a new row that
--                               supersedes the old one, with a reason.
--   legal_notice_files          each PDF kept for a notice (issued, and once
--                               superseded, a second copy stamped so).
--                               Append-only.
--   fund_subscription_booklets  one booklet per approved application, open
--                               until the applicant submits it, then frozen.
--   fund_booklet_answers        the applicant's ticks, one row per field.
--
-- and one catalog stub, `securities_legend`, so counsel has a place for the
-- booklet cover's legend. This task writes no legal text.
--
-- NO ACCOUNT NUMBER IS STORED HERE. A notice keeps the account's uid and its
-- last four only; the full number lives encrypted in #1773's registry and is
-- read through its reveal routes alone.
--
-- Grepped first: none of these tables, and no `securities_legend` row, exists
-- in schema_baseline.sql or any earlier migration.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT outside trigger bodies.

-- ------------------------------------------------------------------ notices
CREATE TABLE IF NOT EXISTS legal_notices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  notice_type       TEXT NOT NULL CHECK (notice_type IN (
                      'capital_call_notice', 'distribution_notice', 'default_notice',
                      'management_fee_statement', 'management_fee_invoice',
                      'platform_licence_fee_invoice', 'payment_instructions_letter')),
  -- What the notice was built from, such as call_line:<id>,
  -- licence:<licensee>:<YYYY-MM-DD> or letter:<purpose>.
  source_ref        TEXT NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 120),
  fund_id           INTEGER REFERENCES vc_funds(id),
  limited_partner_id INTEGER REFERENCES limited_partners(id),
  sender_entity     TEXT NOT NULL CHECK (sender_entity IN ('management', 'holdings', 'gp', 'fund')),
  payee_entity      TEXT CHECK (payee_entity IS NULL OR payee_entity IN ('management', 'holdings', 'gp', 'fund')),
  purpose           TEXT CHECK (purpose IS NULL OR purpose IN (
                      'capital_contribution', 'gp_commitment', 'management_fee', 'platform_licence_fee')),
  bank_account_uid  TEXT,
  account_last4     TEXT CHECK (account_last4 IS NULL OR (length(account_last4) = 4 AND account_last4 NOT GLOB '*[^0-9]*')),
  reference         TEXT CHECK (reference IS NULL OR (length(reference) BETWEEN 1 AND 80 AND reference NOT GLOB '*[^A-Z0-9-]*')),
  amount_cents      INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  page_size         TEXT NOT NULL DEFAULT 'letter' CHECK (page_size IN ('letter', 'a4')),
  figures_json      TEXT NOT NULL CHECK (json_valid(figures_json)),
  figures_sha256    TEXT NOT NULL CHECK (length(figures_sha256) = 64),
  template_slug     TEXT,
  template_version  INTEGER,
  supersedes_id     INTEGER REFERENCES legal_notices(id),
  reason            TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  issued_by         INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- A notice that replaces another says why.
  CHECK (supersedes_id IS NULL OR reason IS NOT NULL)
);
-- One first issue per source, and each source's chain stays linear.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_notices_first
  ON legal_notices(notice_type, source_ref) WHERE supersedes_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_notices_supersedes
  ON legal_notices(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_notices_lp
  ON legal_notices(limited_partner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_notices_fund
  ON legal_notices(fund_id, notice_type);

CREATE TABLE IF NOT EXISTS legal_notice_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  notice_id     INTEGER NOT NULL REFERENCES legal_notices(id),
  stamp         TEXT NOT NULL CHECK (stamp IN ('issued', 'superseded')),
  file_sha256   TEXT NOT NULL CHECK (length(file_sha256) = 64),
  file_bytes    INTEGER NOT NULL CHECK (file_bytes > 0),
  page_size     TEXT NOT NULL CHECK (page_size IN ('letter', 'a4')),
  renderer      TEXT NOT NULL CHECK (renderer IN ('browser_run')),
  paper_sha256  TEXT NOT NULL CHECK (length(paper_sha256) = 64),
  r2_key        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (notice_id, stamp)
);

CREATE TRIGGER IF NOT EXISTS legal_notices_block_update
BEFORE UPDATE ON legal_notices
BEGIN
    SELECT RAISE(ABORT,
        'legal_notices is append-only (D716). An issued notice is what its addressee was asked; issue a superseding notice instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS legal_notices_block_delete
BEFORE DELETE ON legal_notices
BEGIN
    SELECT RAISE(ABORT,
        'legal_notices is append-only (D716). Deleting a notice would remove the record of what was asked.'
    );
END;

CREATE TRIGGER IF NOT EXISTS legal_notice_files_block_update
BEFORE UPDATE ON legal_notice_files
BEGIN
    SELECT RAISE(ABORT, 'legal_notice_files is append-only (D716). A kept file is never rewritten.');
END;

CREATE TRIGGER IF NOT EXISTS legal_notice_files_block_delete
BEFORE DELETE ON legal_notice_files
BEGIN
    SELECT RAISE(ABORT, 'legal_notice_files is append-only (D716). A kept file is never deleted.');
END;

-- ----------------------------------------------------------------- booklets
CREATE TABLE IF NOT EXISTS fund_subscription_booklets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  application_id    INTEGER NOT NULL REFERENCES lp_applications(id),
  fund_slug         TEXT NOT NULL DEFAULT 'spinout-fund-i' CHECK (fund_slug = 'spinout-fund-i'),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'withdrawn')),
  -- Each part's slug, version and body hash, and the ticks, frozen at submit.
  frozen_json       TEXT CHECK (frozen_json IS NULL OR json_valid(frozen_json)),
  digest            TEXT CHECK (digest IS NULL OR length(digest) = 64),
  submitted_at      TEXT,
  withdrawn_by      INTEGER REFERENCES users(id),
  withdrawn_reason  TEXT CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 10 AND 200),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status = 'open' OR status = 'withdrawn' OR (frozen_json IS NOT NULL AND digest IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_reason IS NOT NULL))
);
-- One live booklet per application; a withdrawn one lets the applicant open another.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_subscription_booklets_live
  ON fund_subscription_booklets(application_id) WHERE status <> 'withdrawn';

CREATE TABLE IF NOT EXISTS fund_booklet_answers (
  booklet_id   INTEGER NOT NULL REFERENCES fund_subscription_booklets(id),
  field_id     TEXT NOT NULL CHECK (length(field_id) BETWEEN 1 AND 120),
  checked      INTEGER NOT NULL CHECK (checked IN (0, 1)),
  answered_by  INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booklet_id, field_id)
);

-- A booklet's status moves only open -> submitted, open -> withdrawn or
-- submitted -> withdrawn; what was frozen at submit never changes again.
CREATE TRIGGER IF NOT EXISTS fund_subscription_booklets_status
BEFORE UPDATE OF status ON fund_subscription_booklets
WHEN NEW.status <> OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('submitted', 'withdrawn'))
    OR (OLD.status = 'submitted' AND NEW.status = 'withdrawn'))
BEGIN
    SELECT RAISE(ABORT, 'fund_subscription_booklets: a booklet moves only from open to submitted or withdrawn, or from submitted to withdrawn (D716).');
END;

CREATE TRIGGER IF NOT EXISTS fund_subscription_booklets_frozen
BEFORE UPDATE OF frozen_json, digest, submitted_at, application_id, fund_slug ON fund_subscription_booklets
WHEN (OLD.frozen_json IS NOT NULL AND NEW.frozen_json IS NOT OLD.frozen_json)
  OR (OLD.digest IS NOT NULL AND NEW.digest IS NOT OLD.digest)
  OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS NOT OLD.submitted_at)
  OR NEW.application_id IS NOT OLD.application_id
  OR NEW.fund_slug IS NOT OLD.fund_slug
BEGIN
    SELECT RAISE(ABORT, 'fund_subscription_booklets: a submitted booklet is frozen (D716).');
END;

CREATE TRIGGER IF NOT EXISTS fund_subscription_booklets_block_delete
BEFORE DELETE ON fund_subscription_booklets
BEGIN
    SELECT RAISE(ABORT, 'fund_subscription_booklets: a booklet is never deleted; withdraw it with a reason (D716).');
END;

-- Ticks change only while their booklet is open.
CREATE TRIGGER IF NOT EXISTS fund_booklet_answers_insert_open
BEFORE INSERT ON fund_booklet_answers
WHEN (SELECT status FROM fund_subscription_booklets WHERE id = NEW.booklet_id) IS NOT 'open'
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_answers: the booklet is not open (D716).');
END;

CREATE TRIGGER IF NOT EXISTS fund_booklet_answers_update_open
BEFORE UPDATE ON fund_booklet_answers
WHEN (SELECT status FROM fund_subscription_booklets WHERE id = OLD.booklet_id) IS NOT 'open'
  OR NEW.booklet_id IS NOT OLD.booklet_id
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_answers: the booklet is not open (D716).');
END;

CREATE TRIGGER IF NOT EXISTS fund_booklet_answers_delete_open
BEFORE DELETE ON fund_booklet_answers
WHEN (SELECT status FROM fund_subscription_booklets WHERE id = OLD.booklet_id) IS NOT 'open'
BEGIN
    SELECT RAISE(ABORT, 'fund_booklet_answers: the booklet is not open (D716).');
END;

-- -------------------------------------------------------------- the stub
-- As 468: a catalog entry with no body, inserted only when the slug is free.
INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
SELECT 'securities_legend', 'Securities Legend — Fund I Offering Documents', 'fund', '', '[]', 1, 1, 1
 WHERE NOT EXISTS (SELECT 1 FROM legal_templates t WHERE t.slug = 'securities_legend');
