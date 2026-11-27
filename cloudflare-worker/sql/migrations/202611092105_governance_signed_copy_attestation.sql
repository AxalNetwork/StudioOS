-- D4811 (#4811) part 12 — the execution evidence an externally signed upload
-- carries (board CT-12 B): the date it was signed, who signed it, and the
-- admin who attested that it is the complete, fully signed copy.
--
-- `governance_document_versions` stays append-only (D4563's two triggers):
-- these are set once, in the INSERT of a version uploaded as the signed copy,
-- and never updated. Every row written before this keeps NULL, which the page
-- reads as "Not recorded", never as a date or a person.

ALTER TABLE governance_document_versions ADD COLUMN signed_on TEXT;
ALTER TABLE governance_document_versions ADD COLUMN signatory TEXT;
ALTER TABLE governance_document_versions ADD COLUMN attested_by INTEGER;
