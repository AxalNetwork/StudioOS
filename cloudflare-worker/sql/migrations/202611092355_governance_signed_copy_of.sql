-- D4811 (#4811) part 20 — a signed copy names the approved version it is a
-- copy of (board CT-12 B, CT-92 "Execution evidence": "Execution is bound to
-- one immutable approved version. A draft can never establish execution.").
--
-- `copy_of_version` is set once, in the INSERT of a version uploaded as the
-- signed copy, and only to a version of the same record that counsel approved
-- at that version's exact hash (`legal_reviews`, part 16). The Worker checks
-- it; `governance_document_versions` stays append-only (D4563's triggers).
-- Every row written before this keeps NULL: the page reads it as "No approved
-- version named", never as a version.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE governance_document_versions ADD COLUMN copy_of_version INTEGER;
