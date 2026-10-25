-- 561 — Programs part 2: a studio's program proposals and HQ's decision on
-- each (D955, #2788). Reserved for this part by #2788.
--
-- THE PROPOSAL. One row per proposal a studio admin drafts (PG14, the owner's
-- "Programs" canvas, `design/incoming/Programs Page.dc.html` dc:459-467).
-- `status` is the canvas's five words (dc:325) as keys: draft, sent (Sent to
-- HQ), approved, sent_back and declined. A proposal's status is not a
-- program's: an approval writes a `programs` row whose status is `proposed`,
-- HQ's draft (PROGRAMS_MAP §3).
--
-- `licence_uid` is the sender's studio, read from `licence_admins` as
-- `routes/licence_requests.ts` reads it, or NULL for an admin bound to no
-- licence (HQ-held). No foreign key: a licence is addressed by its uid
-- everywhere it crosses a route.
--
-- In a draft every field may be NULL, which the page reads as "Not set". The
-- list fields are JSON: `who_json` (the canvas's six audience words),
-- `rewards_json` (None, Credits, Cash, Equity), `template_keys` (contract
-- template slugs, checked as part 1 checks a playbook section's) and
-- `tools_json` (the seven switches, stored as declarations: nothing attaches
-- a tool to a program yet).
--
-- THE DECISION. `decision` is `studio` or `catalogue` on an approval;
-- `hq_note` is required for Send back and Decline; `program_key` is the
-- registry row an approval wrote.
--
-- STUDIO-ONLY PROGRAMS. `programs.licence_uid` is NULL for a program every
-- studio sees, and a licence's uid for one approved for that studio only,
-- which only that studio and HQ read.
--
-- Grep first (D689 D-t): no `program_proposals` table and no
-- `programs.licence_uid` column exists in an earlier migration or in
-- schema_baseline.sql.

CREATE TABLE IF NOT EXISTS program_proposals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT    NOT NULL UNIQUE,
  created_by_user_id INTEGER NOT NULL,
  licence_uid        TEXT,
  status             TEXT    NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'approved', 'sent_back', 'declined')),
  -- Basics (dc:463)
  name               TEXT,
  purpose            TEXT,
  who_json           TEXT,
  grp                TEXT
                     CHECK (grp IS NULL OR grp IN ('Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product')),
  -- How it runs (dc:464)
  join_method        TEXT
                     CHECK (join_method IS NULL OR join_method IN ('Open', 'By application', 'By invitation', 'Assigned by an admin')),
  cycle              TEXT    CHECK (cycle IS NULL OR cycle IN ('rolling', 'cohorts')),
  cohort_weeks       INTEGER CHECK (cohort_weeks IS NULL OR (cohort_weeks BETWEEN 1 AND 52)),
  seats              INTEGER CHECK (seats IS NULL OR seats >= 1),
  eligibility        TEXT,
  -- Terms (dc:465)
  rewards_json       TEXT,
  template_keys      TEXT    NOT NULL DEFAULT '[]',
  hq_receives        TEXT,
  -- Tools (dc:466)
  tools_json         TEXT,
  -- Sending and the decision
  sent_at            TEXT,
  decision           TEXT    CHECK (decision IS NULL OR decision IN ('studio', 'catalogue')),
  hq_note            TEXT,
  decided_by_user_id INTEGER,
  decided_at         TEXT,
  program_key        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_program_proposals_studio
  ON program_proposals(licence_uid, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_program_proposals_queue
  ON program_proposals(status, sent_at);

ALTER TABLE programs ADD COLUMN licence_uid TEXT;
