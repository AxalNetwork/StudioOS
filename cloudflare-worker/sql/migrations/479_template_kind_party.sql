-- 479_template_kind_party.sql — D717 (#1782): each legal template's document
-- kind and Axal party, stored on its catalog row.
--
-- Today every render derives both from the slug (`classifyDocument` and
-- `axalEntityKeyForDoc`, services/legalDocFormat.ts), so a slug that routes to
-- the wrong party could only be fixed by a code change. These columns let an
-- admin set them on the row. NULL means "from the slug", today's behaviour, so
-- no existing row changes how it prints.
--
--   legal_templates / legal_template_versions — the editable row and its
--     history; a change is an edit, so the prior values are snapshotted.
--   legal_template_publications — a publication copies both.
--   esign_envelopes — a send records the pair it printed, and every later copy
--     of that envelope reads the envelope's values, never the template's.
--
-- Kinds are services/legalDocFormat.ts's `DocumentKind`; parties are the four
-- Axal entities plus `none`, for a kind with no Axal party. Nothing here can
-- move money, and it seeds nothing.
--
-- STANDS ALONE and idempotent under the runner: additive ALTERs only, no
-- BEGIN/COMMIT.

ALTER TABLE legal_templates ADD COLUMN doc_kind TEXT CHECK (doc_kind IS NULL OR doc_kind IN ('agreement','corporate','resolution','unilateral','policy','notice','booklet'));
ALTER TABLE legal_templates ADD COLUMN axal_party TEXT CHECK (axal_party IS NULL OR axal_party IN ('management','holdings','gp','fund','none'));
ALTER TABLE legal_template_versions ADD COLUMN doc_kind TEXT CHECK (doc_kind IS NULL OR doc_kind IN ('agreement','corporate','resolution','unilateral','policy','notice','booklet'));
ALTER TABLE legal_template_versions ADD COLUMN axal_party TEXT CHECK (axal_party IS NULL OR axal_party IN ('management','holdings','gp','fund','none'));
ALTER TABLE legal_template_publications ADD COLUMN doc_kind TEXT CHECK (doc_kind IS NULL OR doc_kind IN ('agreement','corporate','resolution','unilateral','policy','notice','booklet'));
ALTER TABLE legal_template_publications ADD COLUMN axal_party TEXT CHECK (axal_party IS NULL OR axal_party IN ('management','holdings','gp','fund','none'));
ALTER TABLE esign_envelopes ADD COLUMN doc_kind TEXT CHECK (doc_kind IS NULL OR doc_kind IN ('agreement','corporate','resolution','unilateral','policy','notice','booklet'));
ALTER TABLE esign_envelopes ADD COLUMN axal_party TEXT CHECK (axal_party IS NULL OR axal_party IN ('management','holdings','gp','fund','none'));
