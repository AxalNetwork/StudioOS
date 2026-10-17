-- 475_legal_document_files.sql — D711 (#1776): every legal file the platform
-- keeps or hands out gets a row, and an envelope records the paper it prints on.
--
-- Today each signature re-renders the PDF to one key, `esign/signed/<uuid>.pdf`,
-- so a three-recipient envelope keeps only its newest copy, and no table says
-- which rendered file went where (D711, "Signed copies overwrite each other").
--
-- 1. `esign_envelopes` gains three columns, chosen by the sender and stored so
--    every copy of one envelope matches:
--    - `page_size`: 'letter' (the default: every Axal entity is a Delaware
--      company) or 'a4';
--    - `cover`: 'dark' (the default) or 'light' (for black-and-white printing);
--    - `template_version`: the template version the sender sent, or NULL when
--      the send did not know it. The footer prints it, or prints no version.
--    Existing envelopes read 'letter', 'dark' and NULL. routes/esign.ts's
--    ensureSchema adds the same three columns at runtime; its per-statement
--    try/catch swallows the duplicate once this has run.
-- 2. `legal_document_files`: one row per file kept or handed out. Ids, hashes,
--    sizes and codes only: no name, email, IP or document text. Previews are
--    never stored and get no row. `kind` says what the file is:
--    - `signed_copy`: the copy one signature made (`recipient_id` is its signer);
--    - `docusign_source`: the PDF sent to DocuSign;
--    - `docusign_signed`: the signed PDF DocuSign returned (no paper of ours, so
--      `paper_sha256` is NULL for it alone);
--    - `docx_export`: a template's Word export (no envelope; `template_slug`).
--    The partial UNIQUE index lets the DocuSign webhook and the cron poller both
--    reconcile one envelope and still leave one row per file
--    (`ON CONFLICT … DO NOTHING`).
-- 3. Two triggers refuse UPDATE and DELETE, as 312 seals the receipts: a row
--    is the record that a file existed, and a corrected file is a new row.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE esign_envelopes ADD COLUMN page_size TEXT NOT NULL DEFAULT 'letter'
  CHECK (page_size IN ('letter','a4'));
ALTER TABLE esign_envelopes ADD COLUMN cover TEXT NOT NULL DEFAULT 'dark'
  CHECK (cover IN ('dark','light'));
ALTER TABLE esign_envelopes ADD COLUMN template_version INTEGER
  CHECK (template_version IS NULL OR (typeof(template_version) = 'integer' AND template_version >= 1));

CREATE TABLE IF NOT EXISTS legal_document_files (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL
                   CHECK (kind IN ('signed_copy','docusign_source','docusign_signed','docx_export')),
  envelope_id      INTEGER,
  recipient_id     INTEGER,
  template_slug    TEXT,
  template_version INTEGER
                   CHECK (template_version IS NULL OR (typeof(template_version) = 'integer' AND template_version >= 1)),
  body_sha256      TEXT,
  file_sha256      TEXT NOT NULL CHECK (length(file_sha256) = 64),
  file_bytes       INTEGER NOT NULL CHECK (typeof(file_bytes) = 'integer' AND file_bytes > 0),
  content_type     TEXT NOT NULL,
  page_size        TEXT CHECK (page_size IS NULL OR page_size IN ('letter','a4')),
  renderer         TEXT NOT NULL CHECK (renderer IN ('browser_run','pdf_lib','docusign','docx')),
  paper_sha256     TEXT,
  r2_key           TEXT,
  actor_user_id    INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (kind = 'docx_export' OR envelope_id IS NOT NULL),
  CHECK (kind <> 'signed_copy' OR recipient_id IS NOT NULL),
  CHECK (kind <> 'docx_export' OR template_slug IS NOT NULL),
  CHECK ((kind = 'docusign_signed') = (paper_sha256 IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_legal_document_files_envelope
  ON legal_document_files(envelope_id, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_document_files_template
  ON legal_document_files(template_slug, kind);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_document_files_docusign
  ON legal_document_files(envelope_id, kind, file_sha256)
  WHERE kind IN ('docusign_source','docusign_signed');

-- ------------------------------------------------------------------ the seals
CREATE TRIGGER IF NOT EXISTS legal_document_files_block_update
BEFORE UPDATE ON legal_document_files
BEGIN
    SELECT RAISE(ABORT,
        'legal_document_files is append-only (D711). A row records a file that existed; record the new file instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS legal_document_files_block_delete
BEFORE DELETE ON legal_document_files
BEGIN
    SELECT RAISE(ABORT,
        'legal_document_files is append-only (D711). Deleting a row would lose the record of a file kept or handed out.'
    );
END;
