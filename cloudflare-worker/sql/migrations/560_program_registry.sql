-- 560 — Programs part 1: the program registry, the playbook store and the
-- Learning enrolment events (D954, #2787). Reserved by S1 in D953 §6.
--
-- THE REGISTRY. One row per program the Programs catalogue draws (the owner's
-- canvas, `design/incoming/Programs Page.dc.html` dc:341-349). Until now the
-- nine programs lived only in the canvas and in D953 §3's card table, so
-- "Programs running" read "Not recorded". `status` is the canvas's five words
-- (dc:322) as keys; `grp` is its six groups (dc:358). `purpose`, `who` and
-- `join_method` may be NULL, which the page reads as "Not recorded".
--
-- THE SEED IS D953 §3's WORDS, with its four corrected purposes. A bracketed
-- canvas sample is never stored: AI-native Venture's purpose, who and join stay
-- NULL until OD-AIN. A later part that changes a program's words changes the
-- row only where it still holds this seed (D953 §6, "Copy after the seed").
--
-- THE PLAYBOOK. Ordered sections per program and version. Version 0 is the
-- Super Admin's draft; 1, 2, … are published, each with a row in
-- `program_playbook_versions`. A NULL `body` reads "Not set" (dc:458).
-- `computed` marks a section whose body the page draws from live data, such
-- as Mentor's cycle from the Lab's calendar: it keeps only its heading here.
-- `template_keys` is a JSON list of contract template slugs, each checked
-- against the contracts library when it is saved (D954 §2).
--
-- Version 1 of each program that has a How-it-runs card is seeded from D953
-- §3, and the draft is seeded as a copy of it, so an unedited draft does not
-- differ. AI-native Venture gets a draft of its seven sections, all unset,
-- and no published version until OD-AIN. Spin-Out Lab's page is #2374's and
-- Product testing's is #2382's, so neither has a playbook here.
--
-- THE ENROLMENT EVENTS. A Learning re-enrolment overwrote `enrolled_at`
-- (`routes/admin_learning_programs.ts`), so a learner's first date was lost
-- and enrolments per week could not be counted. From here on each enrol that
-- makes a row active, and each removal, writes one event. The backfill gives
-- one `enrolled` event per existing row at its `enrolled_at`, and one `removed`
-- event per removed row at its `updated_at`. A re-enrolment made before this
-- migration has already overwritten its first date, so it cannot be recovered:
-- it is counted once, at its later date (D954 §6).
--
-- Grep first (D689 D-t): no `programs`, `program_playbook_*` or
-- `learning_enrolment_events` table exists in an earlier migration or in
-- schema_baseline.sql.

CREATE TABLE IF NOT EXISTS programs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  grp         TEXT    NOT NULL
              CHECK (grp IN ('Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product')),
  name        TEXT    NOT NULL,
  purpose     TEXT,
  who         TEXT,
  join_method TEXT,
  status      TEXT    NOT NULL
              CHECK (status IN ('live', 'partly_built', 'not_built', 'proposed', 'paused')),
  position    INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS program_playbook_sections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  program_key       TEXT    NOT NULL REFERENCES programs(key),
  version           INTEGER NOT NULL CHECK (version >= 0),
  section_key       TEXT    NOT NULL,
  position          INTEGER NOT NULL,
  title             TEXT    NOT NULL,
  body              TEXT,
  computed          INTEGER NOT NULL DEFAULT 0 CHECK (computed IN (0, 1)),
  template_keys     TEXT    NOT NULL DEFAULT '[]',
  edited_at         TEXT,
  edited_by_user_id INTEGER,
  UNIQUE (program_key, version, section_key)
);
CREATE INDEX IF NOT EXISTS idx_program_playbook_sections_version
  ON program_playbook_sections(program_key, version, position);

CREATE TABLE IF NOT EXISTS program_playbook_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  program_key          TEXT    NOT NULL REFERENCES programs(key),
  version              INTEGER NOT NULL CHECK (version >= 1),
  published_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  -- NULL for the seeded version 1, which no person published.
  published_by_user_id INTEGER,
  UNIQUE (program_key, version)
);

CREATE TABLE IF NOT EXISTS learning_enrolment_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES learning_programs(id),
  user_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('enrolled', 'removed')),
  -- The member on a self-enrolment, the Super Admin otherwise. NULL on a
  -- backfilled removal: who removed a learner before 560 is not recorded.
  by_user_id INTEGER,
  at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_enrolment_events_program
  ON learning_enrolment_events(program_id, kind, at);

-- ---------------------------------------------------------------------------
-- The nine programs (D953 §3's card table).
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO programs (key, grp, name, purpose, who, join_method, status, position) VALUES
  ('spinout-lab', 'Ventures', 'Spin-Out Lab',
   'Idea to incorporated company in 28 days, one cohort a month.',
   'Founders', 'By application', 'live', 1),
  ('ai-native-venture', 'Ventures', 'AI-native Venture', NULL, NULL, NULL, 'proposed', 2),
  ('mentor-cohorts', 'Access', 'Mentor cohort access',
   'Advisors who mentor a Lab cohort read that cohort’s founders.',
   'Advisors', 'Assigned by an admin', 'live', 3),
  ('investor-cohorts', 'Access', 'Investor cohort access',
   'Verified investors follow one Lab cohort to Demo Day.',
   'Investors', 'Assigned by an admin', 'not_built', 4),
  ('referral-partners', 'Network and referrals', 'Referral partners',
   'People who bring events, startups, deals and LPs.',
   NULL, NULL, 'partly_built', 5),
  ('refer-and-earn', 'Network and referrals', 'Refer & Earn',
   'Members refer founders and platform users. A sign-up through a member''s link earns them an introduction credit.',
   'Founders, investors, advisors and partners', 'Open', 'live', 6),
  ('perks', 'Rewards', 'Perks',
   'Partners list perks; founders claim them with credits, a plan or payment.',
   'Founders claim; other members browse. Partners have their own listings.', 'Open', 'live', 7),
  ('learning', 'Learning', 'Learning',
   'Courses, videos, exercises and exams for a region or a group.',
   'Not open to members yet', 'Open or by invitation', 'live', 8),
  ('product-testing', 'Product', 'Product testing',
   'HQ and partners test their products with members, who apply to each program.',
   'The roles each program names', 'By application', 'live', 9);

-- ---------------------------------------------------------------------------
-- Version 1 of each How-it-runs card (D953 §3), section by section.
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO program_playbook_sections (program_key, version, section_key, position, title, body, computed) VALUES
  -- Mentor cohort access (PG5, dc:377-387, corrected against the code in D953 §3).
  ('mentor-cohorts', 1, 'purpose', 1, 'Purpose',
   'Give each Lab cohort advisors who follow its founders week by week.', 0),
  ('mentor-cohorts', 1, 'who', 2, 'Who it is for',
   'Members with the Advisor role. An advisor needs no profile to be assigned.', 0),
  ('mentor-cohorts', 1, 'join', 3, 'How people join',
   'An admin assigns one advisor to one cohort.', 0),
  ('mentor-cohorts', 1, 'sees', 4, 'What a mentor sees',
   'Founders’ names and email addresses, week-by-week status, who acted on their guidance, and Lab dates. Nothing else in the Lab. A mentor sees a founder once that founder''s first week is recorded.', 0),
  ('mentor-cohorts', 1, 'founders', 5, 'What founders can do',
   'Founders are told when a mentor can read them, and can hide from one mentor, once their first week is recorded. They are told when an admin ends the access.', 0),
  ('mentor-cohorts', 1, 'cycle', 6, 'The cycle', NULL, 1),
  ('mentor-cohorts', 1, 'you-do', 7, 'What you do',
   'Before a cohort starts: assign at least one mentor.
Each week: check for mentors whose role changed.
When a cohort ends: end access, or assign the mentor to the next cohort.', 0),
  ('mentor-cohorts', 1, 'terms', 8, 'Terms and contracts',
   'No contract template is linked to this program yet.', 0),
  ('mentor-cohorts', 1, 'rewards', 9, 'Rewards', 'None set.', 0),
  ('mentor-cohorts', 1, 'measure', 10, 'How we measure it',
   'Mentors per cohort
Founders hidden
Sessions booked with a mentor', 0),
  ('mentor-cohorts', 1, 'admin-tools', 11, 'Admin tools',
   'Assign a mentor: Admin and Super Admin
End access: Admin and Super Admin
Approve office-hours hosts: Admin, on Spin-Out Lab › Hosts
Edit this playbook: Super Admin', 0),

  -- Refer & Earn (PG9).
  ('refer-and-earn', 1, 'who', 1, 'Who refers whom',
   'Founders, investors, advisors and partners refer founders and platform users.', 0),
  ('refer-and-earn', 1, 'strategic', 2, 'Strategic introductions',
   'Strategic and capital introductions are invite-only. No one can be granted access yet.', 0),
  ('refer-and-earn', 1, 'review', 3, 'How a referral is reviewed',
   'An admin moves each referral through its statuses and writes the next step, the reward label and the fit notes. The referrer sees them on their page and is not notified.', 0),
  ('refer-and-earn', 1, 'rewards', 4, 'Rewards',
   'No referral pays perk credits. A sign-up through a member''s referral link earns them one introduction credit once the new member verifies their email. Other rewards are milestone labels, settled off the platform.', 0),

  -- Perks (PG10).
  ('perks', 1, 'purpose', 1, 'Purpose',
   'Partners list perks. Founders claim them with credits, through their plan, or by paying the partner.', 0),
  ('perks', 1, 'who', 2, 'Who it is for',
   'Founders claim; other members browse. Partners have their own listings.', 0),
  ('perks', 1, 'review', 3, 'How a listing is reviewed',
   'A new listing waits for review, and so does a live one its partner edits, unless the edit only raises its claim cap. An admin approves it, or rejects it with a reason the partner sees on their listing. A rejection is final.', 0),
  ('perks', 1, 'paid', 4, 'Paid perks',
   'A paid perk records the claim, and the partner invoices directly.', 0),
  ('perks', 1, 'credits', 5, 'Credits',
   '1 credit is worth $1 of perk value. Credits are paid by the credit rules a Super Admin sets, for Spin-Out Lab milestones, bug bounties and approved tasks, and a Super Admin can also grant or deduct them by hand.', 0),

  -- Learning (PG12).
  ('learning', 1, 'purpose', 1, 'Purpose',
   'Programs of courses, videos, exercises and exams for a region or a group.', 0),
  ('learning', 1, 'authoring', 2, 'Who writes them',
   'HQ writes and publishes each program, and assigns the admins who follow it.', 0),
  ('learning', 1, 'join', 3, 'How people join',
   'Each program is open, or by invitation.', 0),
  ('learning', 1, 'members', 4, 'Who can open it',
   'Members cannot open Learning yet: courses, videos and webinars are coming soon, and Articles are open now.', 0),
  ('learning', 1, 'admins', 5, 'What an assigned admin does',
   'An assigned admin follows its learners, read only, by name.', 0),

  -- Referral partners (PG7).
  ('referral-partners', 1, 'purpose', 1, 'Purpose',
   'People who bring the studio events, startups, deals and LPs.', 0),
  ('referral-partners', 1, 'invitations', 2, 'Partner invitations',
   'Partner deals, their codes and the sign-ups with them are on Partner invitations.', 0),
  ('referral-partners', 1, 'terms', 3, 'Terms',
   'Per-partner terms are not built yet.', 0),

  -- Investor cohort access (PG11): the design, not a running program.
  ('investor-cohorts', 1, 'design', 1, 'How it runs',
   'An admin gives a verified investor access to one cohort.
The investor signs the cohort NDA first.
They see each venture’s summary and weekly progress. Never founders’ email addresses.
Founders are told and can hide themselves from one investor.
An introduction request goes to the founder, who accepts or declines.
Who counts as verified, the cohort NDA, what an investor sees and how a founder answers an introduction are not decided yet.', 0);

INSERT OR IGNORE INTO program_playbook_versions (program_key, version, published_by_user_id)
SELECT DISTINCT program_key, 1, NULL FROM program_playbook_sections WHERE version = 1;

-- Each draft starts as a copy of version 1, so it does not differ until edited.
INSERT OR IGNORE INTO program_playbook_sections
  (program_key, version, section_key, position, title, body, computed, template_keys)
SELECT program_key, 0, section_key, position, title, body, computed, template_keys
  FROM program_playbook_sections WHERE version = 1;

-- AI-native Venture's draft (PG13, dc:458): seven sections, all unset, and no
-- published version until OD-AIN.
INSERT OR IGNORE INTO program_playbook_sections (program_key, version, section_key, position, title, body) VALUES
  ('ai-native-venture', 0, 'thesis', 1, 'Thesis', NULL),
  ('ai-native-venture', 0, 'who', 2, 'Who it is for', NULL),
  ('ai-native-venture', 0, 'length', 3, 'Length', NULL),
  ('ai-native-venture', 0, 'seats', 4, 'Seats per cohort', NULL),
  ('ai-native-venture', 0, 'tools', 5, 'Tools included', NULL),
  ('ai-native-venture', 0, 'capital-terms', 6, 'Capital terms', NULL),
  ('ai-native-venture', 0, 'contracts', 7, 'Contracts', NULL);

-- ---------------------------------------------------------------------------
-- The enrolment backfill.
-- ---------------------------------------------------------------------------

INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at)
SELECT program_id, user_id, 'enrolled', enrolled_by, enrolled_at FROM learning_enrollments;

INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at)
SELECT program_id, user_id, 'removed', NULL, updated_at FROM learning_enrollments WHERE status = 'removed';
