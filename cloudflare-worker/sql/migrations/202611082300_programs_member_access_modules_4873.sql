-- D4873 (#4873, part 2) — two registry facts the Programs operating console draws as their own dimensions.
--
-- MEMBER ACCESS. Whether members can get into a program today, and how. The registry kept only `who` and
-- `join_method`, which say who a program is for and how one would join it, so "Live, yet not open to members"
-- (Learning) was carried as a sentence in `who` and the page compared strings to find it. `member_access` is
-- the fact itself, one of:
--   open      anyone it is for can join
--   apply     by application
--   request   by request, decided by HQ
--   invite    by invitation
--   assigned  an admin assigns people
--   not_open  not open to members yet
--   closed    closed to new members
-- NULL is "Not recorded". It is a record, like `join_method`: each program's own gate still decides what a
-- member can reach.
--
-- THE BACKFILL derives it from what the registry already records, and nothing else:
--   * Learning's `who` says "Not open to members yet", so it is `not_open`.
--   * A program that is `not_built` or `proposed` has nothing to join, so it is `not_open`.
--   * Otherwise the join method names it: Open → open, By application → apply, By invitation… → invite,
--     Assigned by an admin → assigned.
--   * Any other join method, or none, stays NULL.
--
-- MODULES. The capability modules a program's page opens beside its core sections, as a JSON list of keys
-- (applications, hosts, cohorts, referral_queue, perk_queue, learners, influencers, offers, nda_signature).
-- The seed names only the modules that already have an operating screen. A program an approval or New program
-- adds starts with none, '[]', and its page works from the core sections alone.

ALTER TABLE programs ADD COLUMN member_access TEXT
  CHECK (member_access IS NULL OR member_access IN ('open', 'apply', 'request', 'invite', 'assigned', 'not_open', 'closed'));
ALTER TABLE programs ADD COLUMN modules TEXT NOT NULL DEFAULT '[]';

UPDATE programs SET member_access = CASE
    WHEN who = 'Not open to members yet' THEN 'not_open'
    WHEN status IN ('not_built', 'proposed') THEN 'not_open'
    WHEN join_method = 'Open' THEN 'open'
    WHEN join_method = 'By application' THEN 'apply'
    WHEN join_method LIKE 'By invitation%' THEN 'invite'
    WHEN join_method = 'Assigned by an admin' THEN 'assigned'
    ELSE NULL
  END
 WHERE member_access IS NULL;

UPDATE programs SET modules = '["applications","cohorts","hosts"]' WHERE key = 'spinout-lab' AND modules = '[]';
UPDATE programs SET modules = '["cohorts"]' WHERE key = 'mentor-cohorts' AND modules = '[]';
UPDATE programs SET modules = '["cohorts","nda_signature"]' WHERE key = 'investor-cohorts' AND modules = '[]';
UPDATE programs SET modules = '["referral_queue"]' WHERE key IN ('referral-partners', 'refer-and-earn') AND modules = '[]';
UPDATE programs SET modules = '["perk_queue"]' WHERE key = 'perks' AND modules = '[]';
UPDATE programs SET modules = '["learners"]' WHERE key = 'learning' AND modules = '[]';
UPDATE programs SET modules = '["applications","influencers"]' WHERE key = 'influencer' AND modules = '[]';
UPDATE programs SET modules = '["applications"]' WHERE key = 'product-testing' AND modules = '[]';
