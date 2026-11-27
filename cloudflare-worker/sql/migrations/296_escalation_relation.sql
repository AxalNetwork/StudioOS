-- 296 — a content escalation says what it is to the item it names (D275).
--
-- WHAT WAS MISSING. Since D208 a content escalation can NAME the item it
-- concerns: the branch resolves the pick to its own label and sends it as
-- `subject_ref`. Nothing said what the submission was TO that item. A French
-- version of template X and "please fix clause 4 of template X" both name X,
-- so HQ's Localisation lane had no source and its "Localised" count stayed
-- unrecorded.
--
-- THE DECISION, QUOTED RATHER THAN RE-DECIDED: "A content escalation that
-- names an item records an explicit relation, `localises` or `changes`, and
-- the relation is required whenever an item is picked." The routes enforce
-- "required"; this file stores the answer.
--
-- NULL MEANS "NOT RECORDED", NEVER A THIRD VALUE. Every row older than this
-- migration, every row that names no item, and every non-content row has
-- none. A default would claim a relation nobody chose, so there is no default.
--
-- THE VOCABULARY IS CLOSED IN THE SCHEMA TOO. `ADD COLUMN ... CHECK (...)` is
-- both accepted and enforced by SQLite (D196 measured it; re-measured against
-- node:sqlite 3.51 before this file was written: 'localises', 'changes' and
-- NULL insert, a third value, an empty string and a capitalised value raise
-- `CHECK constraint failed`, on INSERT and on UPDATE). The handlers refuse
-- first, with a sentence; this is the backstop.
--
-- ONE FILE FOR BOTH TABLES, as 288 is. HQ and a branch run the same migration
-- list, so both tables exist on both databases (259 and 261).
--
-- Additive only. No BEGIN/COMMIT: D1 rejects transaction control in a
-- migration file.

ALTER TABLE hq_escalations ADD COLUMN relation TEXT
  CHECK (relation IS NULL OR relation IN ('localises', 'changes'));

ALTER TABLE branch_escalations ADD COLUMN relation TEXT
  CHECK (relation IS NULL OR relation IN ('localises', 'changes'));
