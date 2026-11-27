-- D4873 (#4873, part 3) — a proposal's revisions: what each send held, kept as it was sent, and the decision on it.
--
-- A studio sends a proposal; HQ can send it back; the studio edits it in place and sends it again. The proposal row
-- held only its latest fields, so once a sent-back proposal was edited nothing said what HQ had read the first time,
-- and a decision did not say which version it decided. The canvas (PG04) asks for the full submitted specification
-- of one revision, read-only, with its history, and a decision that names the revision it decides.
--
-- `program_proposals.revision` is the number of the latest send (1, 2, …); NULL for a proposal never sent.
--
-- `program_proposal_revisions` holds one row per send: the fields exactly as sent (`spec_json`, the proposal's own
-- columns as a JSON object), when and by whom, and, once HQ decides that revision, the outcome, HQ's note, when and
-- by whom. It is append-only: no row is deleted, the send's half never changes, and the decision's half is written
-- once (the triggers refuse anything else).
--
-- THE BACKFILL records what can be known and no more. Every proposal ever sent gets revision 1 (an earlier send
-- before this migration left no trace, so the history starts here):
--   * sent, approved or declined: a proposal cannot be edited once sent, so its fields are what was sent.
--   * sent back: its fields are what was sent only if nobody edited it after the send-back (`updated_at` is still
--     the decision's time). Otherwise `spec_json` stays NULL: what was sent is not recorded.
--   * a decided revision carries the decision the proposal row holds.

ALTER TABLE program_proposals ADD COLUMN revision INTEGER;

CREATE TABLE IF NOT EXISTS program_proposal_revisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id        INTEGER NOT NULL REFERENCES program_proposals(id),
  revision           INTEGER NOT NULL CHECK (revision >= 1),
  -- NULL only for a backfilled send whose fields were edited before this migration: not recorded.
  spec_json          TEXT,
  sent_at            TEXT,
  sent_by_user_id    INTEGER,
  outcome            TEXT CHECK (outcome IS NULL OR outcome IN ('approved_studio', 'approved_catalogue', 'sent_back', 'declined')),
  hq_note            TEXT,
  decided_at         TEXT,
  decided_by_user_id INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (proposal_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_program_proposal_revisions_proposal ON program_proposal_revisions(proposal_id, revision);

CREATE TRIGGER IF NOT EXISTS program_proposal_revisions_no_delete BEFORE DELETE ON program_proposal_revisions
BEGIN SELECT RAISE(ABORT, 'program_proposal_revisions is append-only'); END;

-- The send's half never changes; the decision's half is written once.
CREATE TRIGGER IF NOT EXISTS program_proposal_revisions_once BEFORE UPDATE ON program_proposal_revisions
WHEN OLD.outcome IS NOT NULL
  OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.revision IS NOT OLD.revision
  OR NEW.spec_json IS NOT OLD.spec_json OR NEW.sent_at IS NOT OLD.sent_at OR NEW.sent_by_user_id IS NOT OLD.sent_by_user_id
BEGIN SELECT RAISE(ABORT, 'a sent revision does not change, and its decision is written once'); END;

UPDATE program_proposals SET revision = 1 WHERE revision IS NULL AND status != 'draft' AND sent_at IS NOT NULL;

INSERT OR IGNORE INTO program_proposal_revisions
  (proposal_id, revision, spec_json, sent_at, sent_by_user_id, outcome, hq_note, decided_at, decided_by_user_id)
SELECT id, 1,
  CASE WHEN status IN ('sent', 'approved', 'declined') OR (status = 'sent_back' AND decided_at IS NOT NULL AND updated_at <= decided_at)
    THEN json_object('name', name, 'purpose', purpose, 'who_json', who_json, 'grp', grp, 'join_method', join_method,
      'cycle', cycle, 'cohort_weeks', cohort_weeks, 'seats', seats, 'eligibility', eligibility, 'rewards_json', rewards_json,
      'template_keys', template_keys, 'hq_receives', hq_receives, 'tools_json', tools_json)
    ELSE NULL END,
  sent_at, NULL,
  CASE status WHEN 'approved' THEN CASE decision WHEN 'studio' THEN 'approved_studio' ELSE 'approved_catalogue' END
              WHEN 'sent_back' THEN 'sent_back' WHEN 'declined' THEN 'declined' ELSE NULL END,
  CASE WHEN status = 'sent' THEN NULL ELSE hq_note END,
  CASE WHEN status = 'sent' THEN NULL ELSE decided_at END,
  CASE WHEN status = 'sent' THEN NULL ELSE decided_by_user_id END
FROM program_proposals
WHERE revision = 1 AND status != 'draft';
