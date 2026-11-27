-- 202611082049 — D5032 (#5032): HQ's ticket SLA policy carries a version, and
-- a branch records which version it applies. Named by its UTC minute (D4106).
--
-- WHAT WAS WRONG. HQ edits the P1/P2/P3 hours (`hq_support_sla_tiers`,
-- migration 333, D482), but the copy that would carry them to a branch was
-- held: a branch banded its tickets with the hours it shipped with, and
-- nothing could tell HQ which hours those were.
--
-- ONE ROW, ON EVERY DATABASE. Every database runs this file, HQ's and each
-- branch's, and the row means the same on both: the version of the tier rows
-- in `hq_support_sla_tiers` on THIS database.
--
--   source = 'hq'      HQ's own policy. `version` advances with every save
--                      that changes a tier (`PUT /api/admin/hq-support/sla-tiers`),
--                      in the same batch as the tier rows.
--   source = 'pushed'  a branch's copy, written by `applyLicenceCopy` from the
--                      licence push, in the same batch as the tier rows it
--                      carried. `version` is HQ's number.
--
-- NO SEED. A database whose tiers were never saved or pushed since this file
-- has no row, and that is the truth: its hours carry no number. HQ numbers its
-- policy 1 the first time it distributes it; a branch with no row is reported
-- as holding no version, never as current.

CREATE TABLE IF NOT EXISTS support_sla_policy_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL CHECK (version >= 1),
  source     TEXT NOT NULL CHECK (source IN ('hq', 'pushed')),
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
