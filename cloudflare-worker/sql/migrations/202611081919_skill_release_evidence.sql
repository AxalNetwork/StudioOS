-- 202611081919 — D4533 (#4533, step 3 of #4528): release evidence for Axal's own skills.
-- Named by its UTC minute (D4106).
--
-- WHY A MIGRATION. Until now an approval and an eval result were bound to the
-- draft's definition hash alone (`draftHash`). A case added or removed after
-- the approval left the hash unchanged, the evaluator version was recorded
-- nowhere, and the models a draft had to pass on were whichever models had
-- results. Three facts are missing from D1 and cannot be derived afterwards:
--   1. the model set a draft must pass on (it is a choice, not a fact in any row);
--   2. the evidence an approval and a result were given on (the case suite,
--      evaluator version and model set as they stood then);
--   3. what a published version was released on.
-- The suite revision itself is NOT stored separately: it is derived from the
-- live cases' immutable identities (`skillLifecycle.ts`, `evidenceOf`).
--
--   agent_skills.required_models_json   the draft's declared model set, a sorted JSON
--                                        array of catalogue ids; NULL means the default
--                                        set (the models agents may run on, as Re-run evals uses)
--   agent_skill_reviews.evidence_hash   SHA-256 of [definition hash, suite revision,
--   agent_skill_eval_results.evidence_hash  evaluator version, required models]: what the
--                                        review was asked on, what the result was run under
--   agent_skill_reviews.evidence_json   the parts behind that hash, so a reviewer sees what changed
--   agent_skill_versions.evidence_json  the release-evidence manifest of an HQ version, written
--                                        in the same INSERT as the version row
--
-- HISTORICAL ROWS. Nothing is backfilled: a review, result or version from
-- before this file has NULL evidence, because nobody recorded it. Such a review
-- or result never counts towards a new publish; such a version stays published
-- and pinned, and reads "no manifest" (D4533).
--
-- KEPT AS WRITTEN. A published version row was already never updated (759);
-- it is now never deleted either. A golden case is never edited in place (its
-- one change is `removed_at`, once), an eval result is never changed or
-- deleted, and a review keeps what it was asked on.
--
-- ALTER TABLE ... ADD COLUMN is not re-runnable; the migration ledger stops the replay.
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE agent_skills ADD COLUMN required_models_json TEXT;
ALTER TABLE agent_skill_reviews ADD COLUMN evidence_hash TEXT CHECK (evidence_hash IS NULL OR length(evidence_hash) = 64);
ALTER TABLE agent_skill_reviews ADD COLUMN evidence_json TEXT;
ALTER TABLE agent_skill_eval_results ADD COLUMN evidence_hash TEXT CHECK (evidence_hash IS NULL OR length(evidence_hash) = 64);
ALTER TABLE agent_skill_versions ADD COLUMN evidence_json TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_skill_eval_results_evidence ON agent_skill_eval_results (skill_id, evidence_hash, case_id, model_id, id);

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_versions_kept
BEFORE DELETE ON agent_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_versions rows are kept');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_cases_immutable
BEFORE UPDATE ON agent_skill_cases
WHEN OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL
  OR NEW.uid IS NOT OLD.uid OR NEW.skill_id IS NOT OLD.skill_id OR NEW.name IS NOT OLD.name
  OR NEW.input_json IS NOT OLD.input_json OR NEW.expect_json IS NOT OLD.expect_json
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_cases rows are immutable; a case is only removed, once');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_cases_kept
BEFORE DELETE ON agent_skill_cases
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_cases rows are kept');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_eval_results_immutable
BEFORE UPDATE ON agent_skill_eval_results
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_eval_results rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_eval_results_kept
BEFORE DELETE ON agent_skill_eval_results
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_eval_results rows are kept');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_reviews_evidence_kept
BEFORE UPDATE OF skill_id, draft_hash, requested_by, reviewer_id, requested_at, evidence_hash, evidence_json ON agent_skill_reviews
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_reviews keep what they were asked on');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_reviews_decided_kept
BEFORE UPDATE ON agent_skill_reviews
WHEN OLD.status <> 'requested'
BEGIN
  SELECT RAISE(ABORT, 'a decided agent_skill_reviews row is final');
END;
