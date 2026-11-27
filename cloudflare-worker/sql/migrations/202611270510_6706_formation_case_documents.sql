-- D6706 (#6706, plan key E14 of #6680): a case's generated documents, the
-- envelopes it sends, and the consent-to-act gate on filing.
--
-- formation_case_documents (D6694) gains where a row came from:
--   origin        generated (filled from a template by services/formationDocuments.ts),
--                 signed_copy (an envelope the case sent came back signed), or
--                 consent_upload (an appointee's consent uploaded by HQ or a partner).
--                 NULL is every row written before this migration, and every row
--                 formationFilings.ts or formationRequests.ts writes.
--   template_key  the template a generated row was filled from (and a signed copy's source).
--   person_id     the appointee a consent or a per-person document is for.
--   sha256        the SHA-256 of the generated text, or of the signed copy's file.
-- One generated row per (case, template, person): a second generation reuses it.
--
-- formation_case_envelopes: an e-sign envelope the case sent, the document it
-- carries and, for a consent to act, the person and the person's revision when
-- it was sent. The signed copy comes back through the owed esign_effects record
-- (`formation_case_signed`, services/esignEffects.ts) written with this row.
--
-- The trigger holds the consent rule in the store: an incorporation filing
-- does not move from prepared to submitted while an appointee (director,
-- resident or managing director, secretary, legal representative) of its case
-- has no consent_to_act_at. formationFilings.ts refuses first, with a code.
--
-- Additive only. STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE formation_case_documents ADD COLUMN origin TEXT
  CHECK (origin IS NULL OR origin IN ('generated', 'signed_copy', 'consent_upload'));
ALTER TABLE formation_case_documents ADD COLUMN template_key TEXT;
ALTER TABLE formation_case_documents ADD COLUMN person_id INTEGER;
ALTER TABLE formation_case_documents ADD COLUMN sha256 TEXT
  CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_formation_case_documents_generated
  ON formation_case_documents(case_id, template_key, COALESCE(person_id, 0)) WHERE origin = 'generated';

CREATE TABLE IF NOT EXISTS formation_case_envelopes (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id                  INTEGER NOT NULL,
  envelope_id              INTEGER NOT NULL UNIQUE,
  purpose                  TEXT NOT NULL CHECK (purpose IN ('document', 'consent_to_act')),
  -- The generated case document sent, or NULL when a contract template was sent from the library.
  source_case_document_id  INTEGER,
  template_key             TEXT,
  person_id                INTEGER,
  -- The person's revision when sent: an edit after it (which clears consent) makes this envelope's consent stale.
  person_revision          INTEGER,
  sent_by                  INTEGER,
  signed_case_document_id  INTEGER,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (purpose <> 'consent_to_act' OR (person_id IS NOT NULL AND person_revision IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_formation_case_envelopes_case ON formation_case_envelopes(case_id, id);

CREATE TRIGGER IF NOT EXISTS trg_formation_filing_consent_to_act
BEFORE UPDATE OF state ON formation_filings
WHEN NEW.kind = 'incorporation' AND OLD.state = 'prepared' AND NEW.state = 'submitted' AND NEW.recorded_after_the_fact = 0
  AND EXISTS (SELECT 1 FROM formation_case_people p JOIN formation_case_person_roles r ON r.person_id = p.id
               WHERE p.case_id = NEW.case_id AND p.removed_at IS NULL AND p.consent_to_act_at IS NULL
                 AND r.role IN ('director', 'resident_director', 'managing_director', 'secretary', 'legal_representative'))
BEGIN
  SELECT RAISE(ABORT, 'formation_consent_to_act_missing');
END;
