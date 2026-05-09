-- Task #2 — Admin "All Contracts" union view + forward-migration
-- Adds a back-pointer column on the legacy `documents` table so we can mark
-- rows that have been ported into `esign_envelopes`. Once migrated, the
-- `documents` row stays in place (audit) but is excluded from the admin
-- contracts list to avoid double-counting.
--
-- Idempotent caveat: D1 ALTER TABLE … ADD COLUMN does NOT support IF NOT
-- EXISTS. Re-running this migration after first apply will report
-- "duplicate column name: migrated_to_esign_id" — that error is expected
-- and harmless; the index step is wrapped in IF NOT EXISTS and will be a
-- no-op on re-run.
ALTER TABLE documents ADD COLUMN migrated_to_esign_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_migrated_to_esign
  ON documents(migrated_to_esign_id);

-- Data backfill — copy contract-type rows from `documents` into
-- `esign_envelopes`, preserving timestamps and file keys, and tag the
-- originating row with `migrated_to_esign_id`.
--
-- Eligibility: rows that have a meaningful contract status (sent | signed
-- | void) and are NOT already migrated. Drafts/generated rows stay where
-- they are — they're templates, not envelopes.
--
-- Status mapping documents → esign_envelopes:
--   'sent'    → 'sent'
--   'signed'  → 'completed' (mirror via signed_r2_key when present)
--   'void'    → 'rejected'
--
-- We do NOT seed `esign_recipients` rows during backfill — the legacy
-- `documents` table has no recipient list, only an opaque `signed_by`
-- string. Audit trails for migrated rows therefore live in
-- `documents.signed_by` + `documents.signed_at` and the union view
-- continues to surface them via the back-pointer join.
INSERT INTO esign_envelopes (
  envelope_uuid, user_id, deal_id,
  document_type, document_title, document_body, body_sha256,
  signed_r2_key, status,
  audit_log, created_by, created_at, completed_at
)
SELECT
  -- Stable synthetic uuid derived from the legacy uid so re-runs collide
  -- on the UNIQUE(envelope_uuid) constraint and are skipped via INSERT OR
  -- IGNORE-equivalent (we use INSERT … WHERE NOT EXISTS below for D1).
  d.uid,
  NULL, NULL,
  COALESCE(d.doc_type, 'legacy_contract'),
  d.title,
  COALESCE(d.content, ''),
  '',
  d.file_key,
  CASE LOWER(d.status)
    WHEN 'signed' THEN 'completed'
    WHEN 'void'   THEN 'rejected'
    ELSE 'sent'
  END,
  '[]',
  COALESCE((SELECT founder_id FROM projects WHERE id = d.project_id), 0),
  d.created_at,
  CASE WHEN LOWER(d.status) = 'signed' THEN d.signed_at ELSE NULL END
FROM documents d
WHERE d.migrated_to_esign_id IS NULL
  AND LOWER(COALESCE(d.status, '')) IN ('sent', 'signed', 'void')
  -- Only migrate ACTUAL contract doc_types — keep this list in sync with
  -- CONTRACT_DOC_TYPES in cloudflare-worker/src/routes/admin_contracts.ts.
  -- Templates, memos, drafts, and other non-contract documents stay in
  -- `documents` so contract stats/listings aren't distorted.
  AND LOWER(COALESCE(d.doc_type, '')) IN (
    'operating_agreement','carried_interest','ic_charter','service_agreement',
    'lpa','ppm','subscription','mgmt_company',
    'safe','term_sheet','bylaws','equity_split','ip_license','spa','voting_rights',
    'form_adv','aml_kyc','section_83b'
  )
  AND NOT EXISTS (SELECT 1 FROM esign_envelopes e WHERE e.envelope_uuid = d.uid);

-- Tag the originals with the new envelope id so the union read path can
-- exclude them. Match by envelope_uuid = documents.uid (set above).
UPDATE documents
   SET migrated_to_esign_id = (
         SELECT id FROM esign_envelopes WHERE envelope_uuid = documents.uid
       )
 WHERE migrated_to_esign_id IS NULL
   AND LOWER(COALESCE(status, '')) IN ('sent', 'signed', 'void')
   AND LOWER(COALESCE(doc_type, '')) IN (
     'operating_agreement','carried_interest','ic_charter','service_agreement',
     'lpa','ppm','subscription','mgmt_company',
     'safe','term_sheet','bylaws','equity_split','ip_license','spa','voting_rights',
     'form_adv','aml_kyc','section_83b'
   )
   AND EXISTS (SELECT 1 FROM esign_envelopes WHERE envelope_uuid = documents.uid);
