-- 202611090905 — D4531 slice 3 (#4531): a published evaluation result names the evaluator that judged it and the case
-- text it ran. Named by its UTC minute (D4106). The draft history's column is 202611090904_skill_eval_result_identity.sql;
-- the reason for both is written there.
--
-- `case_sha256` is `caseSha` (services/agents/skillLifecycle.ts) of the case as checked and run: a starter case's text
-- ships with the code and can change between versions under the same `case_key`, so the key alone does not say two
-- results ran the same case. NULL is "Not recorded" (rows from before this migration), never a match.
ALTER TABLE agent_skill_version_evals ADD COLUMN evaluator_version INTEGER CHECK (evaluator_version IS NULL OR evaluator_version >= 1);
ALTER TABLE agent_skill_version_evals ADD COLUMN case_sha256 TEXT CHECK (case_sha256 IS NULL OR length(case_sha256) = 64);
