-- D4808 (#4808) — the exact proposal an approval made a program from, kept as it was approved.
--
-- Approving a studio's proposal writes the registry row and a playbook draft (D955). The registry row
-- keeps only purpose, who and join, so eligibility, rewards, templates, tools and what HQ receives were
-- readable only on the proposal itself, and a program's page could not say what was approved. This table
-- holds a frozen copy of the approved proposal (`spec_json`) beside the proposal's uid, one row per
-- program, written in the same batch as the approval. It is append-only: the triggers refuse an
-- UPDATE or a DELETE, so the snapshot of what was approved never changes after the fact.
CREATE TABLE IF NOT EXISTS program_approved_specs (
  program_key  TEXT PRIMARY KEY,
  proposal_uid TEXT NOT NULL,
  decision     TEXT NOT NULL,
  decided_at   TEXT NOT NULL,
  spec_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_program_approved_specs_proposal ON program_approved_specs(proposal_uid);

CREATE TRIGGER IF NOT EXISTS program_approved_specs_no_update BEFORE UPDATE ON program_approved_specs
BEGIN SELECT RAISE(ABORT, 'program_approved_specs is append-only'); END;

CREATE TRIGGER IF NOT EXISTS program_approved_specs_no_delete BEFORE DELETE ON program_approved_specs
BEGIN SELECT RAISE(ABORT, 'program_approved_specs is append-only'); END;
