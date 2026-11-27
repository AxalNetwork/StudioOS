-- 202611130253 — D4538 part 2 (#4538, Skill Library session 10): a company extension's lineage.
-- Named by its UTC minute and its issue (D4106, D5398).
--
-- D4538 chose FORK WITH PROVENANCE: an extension is an ordinary
-- `scope = 'company'` skill, created from one immutable published version of
-- an HQ skill, that records which skill and which version it came from. The
-- run gate, pins, release evidence, moderation and costs read it exactly as
-- they read any company skill; nothing here changes what an agent runs.
--
--   agent_skills.based_on_skill_uid     the HQ skill's uid (`agent_skills.uid` of a `scope = 'hq'` row)
--   agent_skills.based_on_version       that HQ skill's published version the fork was copied from (>= 1)
--   agent_skills.fork_reason            why the company forked it, 1 to 300 characters once trimmed
--   agent_skill_versions.based_on_version  the HQ base each published company version was built from,
--                                       written in the version's own INSERT, so as immutable as its row
--
-- ALL OR NOTHING. The three `agent_skills` columns are all NULL (a standalone
-- skill) or all set, and only on a company skill: the CHECK on `fork_reason`
-- (added last, so it can name the two before it) says so. SQLite tests a new
-- column's CHECK against the rows already there; every one of them reads NULL
-- in all three columns and passes.
--
-- EXISTING ROWS. Nothing is backfilled and nothing is converted: every skill
-- written before this file is standalone and stays so (D4538, "Existing
-- company skills"). A company skill copied from an HQ SKILL.md through
-- `POST /api/teams/skills` before this file has no recorded source, and none
-- is guessed for it.
--
-- NO FOREIGN KEY on `based_on_skill_uid`: an HQ skill is never deleted (it is
-- retired), and the read joins on the uid within `scope = 'hq'`, so a
-- company row can never point at another company's skill.
--
-- ALTER TABLE ... ADD COLUMN is not re-runnable; the migration ledger stops the replay.
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE agent_skills ADD COLUMN based_on_skill_uid TEXT CHECK (based_on_skill_uid IS NULL OR length(based_on_skill_uid) = 32);
ALTER TABLE agent_skills ADD COLUMN based_on_version INTEGER CHECK (based_on_version IS NULL OR based_on_version >= 1);
ALTER TABLE agent_skills ADD COLUMN fork_reason TEXT CHECK (
  (based_on_skill_uid IS NULL AND based_on_version IS NULL AND fork_reason IS NULL)
  OR (scope = 'company' AND based_on_skill_uid IS NOT NULL AND based_on_version IS NOT NULL
      AND fork_reason IS NOT NULL AND length(trim(fork_reason)) BETWEEN 1 AND 300 AND length(fork_reason) <= 300)
);

ALTER TABLE agent_skill_versions ADD COLUMN based_on_version INTEGER CHECK (based_on_version IS NULL OR based_on_version >= 1);

-- "Which of this company's skills are based on this HQ skill": the base-update read and HQ's lineage view.
CREATE INDEX IF NOT EXISTS idx_agent_skills_based_on ON agent_skills (based_on_skill_uid, company_id) WHERE based_on_skill_uid IS NOT NULL;
