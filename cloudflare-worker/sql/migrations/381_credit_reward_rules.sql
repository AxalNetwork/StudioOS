-- D540 (#1103) — the credit reward rules, and which rule each ledger grant used.
--
-- 1 credit = US$1 of perk value. Every amount a reward pays lives in this
-- table, which the Super Admin edits (routes/admin_credit_rules.ts); no amount
-- is written in code. services/creditGrants.ts is the only writer of a
-- rule-based grant, and it reads the amount from here at the moment it grants.
--
-- The seeded amounts are the defaults S1 put to the owner in #1102 question 3.
-- They stand until the owner answers there, and every one is editable after.
--
--   bug_high / bug_medium / bug_low        150 / 60 / 20 (#1105 grants them)
--   feature_shipped_high / _medium / _low  the bug tiers (#1102 question 2, pick B)
--   task_approved                          10 (#1107 grants it)
--   lab:<milestone_key>                    the Spin-Out Lab table in #1102 (#1104)
--   cap:bounty_monthly                     500: the most bounty credits one user
--                                          can be granted in a calendar month (UTC).
--                                          Not a reward; grantCredits never pays it.
--
-- `advisor_meeting_booked` and `cofounder_request_sent` both carry 50 because
-- #1102 pays "the first of" the two; #1104 grants only the first one recorded.
-- Week 1's required milestones carry no rule: the required path that #1102
-- totals at 1,000 credits starts in week 2.
--
-- `perk_credit_ledger.rule_key` names the rule a grant was paid under. It is
-- nullable with no backfill: a grant made before D540 (POST /perks/admin/credits)
-- was paid under no rule, and stays that way.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration
-- ledger stops the replay.
CREATE TABLE IF NOT EXISTS credit_reward_rules (
    key             TEXT PRIMARY KEY,
    credits         INTEGER NOT NULL CHECK (credits >= 0),
    usd_value_cents INTEGER NOT NULL CHECK (usd_value_cents >= 0),
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO credit_reward_rules (key, credits, usd_value_cents) VALUES
    ('bug_high', 150, 15000),
    ('bug_medium', 60, 6000),
    ('bug_low', 20, 2000),
    ('feature_shipped_high', 150, 15000),
    ('feature_shipped_medium', 60, 6000),
    ('feature_shipped_low', 20, 2000),
    ('task_approved', 10, 1000),
    ('cap:bounty_monthly', 500, 50000),
    ('lab:okrs_created', 50, 5000),
    ('lab:brand_basics_filled', 50, 5000),
    ('lab:pitch_deck_drafted', 100, 10000),
    ('lab:scoring_run_completed', 100, 10000),
    ('lab:advisor_meeting_booked', 50, 5000),
    ('lab:cofounder_request_sent', 50, 5000),
    ('lab:incorporation_completed', 400, 40000),
    ('lab:graduation', 250, 25000),
    ('lab:customer_interview_logged_4', 10, 1000),
    ('lab:customer_interview_logged_5', 10, 1000),
    ('lab:market_sizing_completed', 10, 1000),
    ('lab:profiling_completed', 10, 1000),
    ('lab:icp_defined', 10, 1000),
    ('lab:market_research_shared', 10, 1000),
    ('lab:mvp_scoped', 10, 1000),
    ('lab:landing_page_created', 10, 1000),
    ('lab:discovery_followups_mapped', 10, 1000),
    ('lab:office_hours_booked', 10, 1000),
    ('lab:revenue_proof_added', 10, 1000),
    ('lab:revenue_summary_generated', 10, 1000),
    ('lab:scoring_confidence_70', 10, 1000),
    ('lab:ein_received', 10, 1000),
    ('lab:founder_stock_issued', 10, 1000),
    ('lab:section83b_filed', 10, 1000),
    ('lab:cofounder_agreement_signed', 10, 1000),
    ('lab:fundraise_ask_locked', 10, 1000),
    ('lab:use_of_funds_filled', 10, 1000),
    ('lab:investor_intros_secured', 10, 1000),
    ('lab:captable_locked', 10, 1000),
    ('lab:data_room_built', 10, 1000);

ALTER TABLE perk_credit_ledger ADD COLUMN rule_key TEXT;
