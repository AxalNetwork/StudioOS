-- 566 — D965 (#2798), Programs part 12: the referral rewards paid in perk
-- credits. Reserved by S1 in D953 §6.
--
-- THE RULES. The owner answered O-CRD with A (#2798, 2026-10-26), the
-- canvas's figures: a startup referral pays 100 credits when it moves to
-- Converted (on acceptance) and 400 when it moves to Reward issued (on
-- formation); a platform user referral pays 50 when it moves to Reward issued
-- (once onboarded). Strategic introductions are agreed case by case and get
-- no rule. Partner referrers get no perk credits: `grantCredits` refuses
-- partner and admin recipients, and their referrals still move.
--
-- 1 credit is US$1 (`routes/admin_credit_rules.ts`), so `usd_value_cents` is
-- credits × 100. Every key starts `referral:`. From here on the Super Admin
-- edits each amount in Credit rules, with a reason, like every other rule;
-- the code names only which status pays which rule
-- (`REFERRAL_REWARD_RULES`, `services/referralSubmissions.ts`).
--
-- THE COPY. Part 1 (#2787, migration 560) seeded Refer & Earn's purpose and
-- its How-it-runs Rewards section with "No referral pays perk credits." Each
-- is updated only where it still holds that seed word for word, so an HQ
-- edit is never overwritten (D953 §6, "Copy after the seed"). Version 1 was
-- published by no one, and the draft is its copy, so both change together.
-- The amounts are not written into the copy: HQ can change them, and the
-- Rewards card on Overview reads them from the rules.
--
-- Re-runnable: INSERT OR IGNORE, and each UPDATE matches only the seed text.

INSERT OR IGNORE INTO credit_reward_rules (key, credits, usd_value_cents) VALUES
    ('referral:startup_accepted', 100, 10000),
    ('referral:startup_formed', 400, 40000),
    ('referral:customer_onboarded', 50, 5000);

UPDATE programs
   SET purpose = 'Members refer founders and platform users, and earn perk credits when a referral is accepted, forms or is onboarded. A sign-up through a member''s link earns them an introduction credit.'
 WHERE key = 'refer-and-earn'
   AND purpose = 'Members refer founders and platform users. A sign-up through a member''s link earns them an introduction credit.';

UPDATE program_playbook_sections
   SET body = 'A startup referral pays its referrer perk credits when it moves to Converted (on acceptance) and again when it moves to Reward issued (on formation). A platform user referral pays when it moves to Reward issued (once onboarded). The amounts are the referral rules in Credit rules, and the Rewards card on Overview shows them. Strategic introductions are agreed case by case. Partner referrers are not paid perk credits. A sign-up through a member''s referral link also earns them one introduction credit once the new member verifies their email; introduction credits are not perk credits.'
 WHERE program_key = 'refer-and-earn' AND section_key = 'rewards' AND version IN (0, 1)
   AND body = 'No referral pays perk credits. A sign-up through a member''s referral link earns them one introduction credit once the new member verifies their email. Other rewards are milestone labels, settled off the platform.';
