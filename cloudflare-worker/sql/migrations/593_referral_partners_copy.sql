-- 593 — D963 (#2796), Programs part 10: the copy for Referral partners,
-- Investor cohort access and AI-native Venture, now that parts 5 and 6 are
-- built and OD-AIN is answered. Reserved by S1 for #2796 (renumbered from 567
-- on 2026-10-25).
--
-- REFERRAL PARTNERS (D958, OD3 A). Part 1 (#2787, migration 560) seeded the
-- program's Who and Join as NULL ("Set with partner terms, which are not built
-- yet.") and its How-it-runs Terms section as "Per-partner terms are not built
-- yet." Part 5 built the terms, so Who and Join take part 5's facts
-- (`FACTS`, services/referralPartnerTerms.ts) and the purpose says how a
-- partner is paid. The canvas's "each under their own signed terms" is not
-- written: a partner without custom terms earns under the standard rules.
--
-- INVESTOR COHORT ACCESS (D959). The How-it-runs section ended with "…are not
-- decided yet." O-VER, O-NDA, O-INT and O-SEE are answered, so the five lines
-- are rewritten from the answers and that line goes. The status stays
-- `not_built`: whether the program runs is HQ's to set in the registry, and
-- the status also decides whether HQ may offer it to studios
-- (services/programGrantStates.ts), which is #2376's.
--
-- AI-NATIVE VENTURE (OD-AIN A, S1's pick recorded on #2796 on 2026-10-26).
-- Purpose, Who and Join were NULL until the answer. The playbook draft stays
-- as 560 left it: HQ writes it, and an unset section reads "Not set".
--
-- Each UPDATE matches only the seed text (or the seed NULL), so an HQ edit is
-- never overwritten (D953 §6, "Copy after the seed"). Version 1 was published
-- by no one and the draft is its copy, so both change together.
-- Re-runnable: a second run matches nothing.

UPDATE programs
   SET purpose = 'People who bring events, startups, deals and LPs, under the standard rules or their own signed terms.',
       updated_at = datetime('now')
 WHERE key = 'referral-partners'
   AND purpose = 'People who bring events, startups, deals and LPs.';

UPDATE programs
   SET who = 'Members HQ adds as referral partners, in one of three segments: Event organisers, Venture scouts and Deal makers.',
       join_method = 'By invitation. HQ adds the partner; their own referral code earns.',
       updated_at = datetime('now')
 WHERE key = 'referral-partners' AND who IS NULL AND join_method IS NULL;

UPDATE program_playbook_sections
   SET body = 'A partner earns under the standard commission rules, or under custom terms: an admin drafts them, the Super Admin approves them, and they take effect only once the partner signs.
Signed terms pay instead of the standard rule, within their caps, and pay no L2 or L3 bonus.
Today only a referred member''s identity check pays. The other standard rules have no event that fires them yet.'
 WHERE program_key = 'referral-partners' AND section_key = 'terms' AND version IN (0, 1)
   AND body = 'Per-partner terms are not built yet.';

UPDATE program_playbook_sections
   SET body = 'An admin gives a verified investor access to one cohort, until an end date. Verified means an investor account that is active, with approved KYC, checked on every read.
The investor signs the cohort NDA, one per grant, before they read anything.
They see each venture’s summary and weekly progress. Never a founder’s email address. Pitch deck and Demo Day are not open yet.
Founders are told when an investor can read them, and can hide themselves from one investor.
An investor can ask a founder for an introduction. The founder accepts or declines once, and writes first.'
 WHERE program_key = 'investor-cohorts' AND section_key = 'design' AND version IN (0, 1)
   AND body = 'An admin gives a verified investor access to one cohort.
The investor signs the cohort NDA first.
They see each venture’s summary and weekly progress. Never founders’ email addresses.
Founders are told and can hide themselves from one investor.
An introduction request goes to the founder, who accepts or declines.
Who counts as verified, the cohort NDA, what an investor sees and how a founder answers an introduction are not decided yet.';

UPDATE programs
   SET purpose = 'Founders build an AI-native company with Eadwyn and the studio’s tools.',
       who = 'Founders',
       join_method = 'By application',
       updated_at = datetime('now')
 WHERE key = 'ai-native-venture' AND purpose IS NULL AND who IS NULL AND join_method IS NULL;
