-- 407 — feature requests earn no credits (D544 note, #1107; the owner's answer
-- Q2 A on #1102).
--
-- Migration 381 seeded `feature_shipped_high`, `_medium` and `_low` at the bug
-- tiers, on S1's pick B for #1102 question 2. The owner answered A: a feature
-- request earns nothing, and approving one grants nothing. So the three rules
-- are switched off, and `grantCredits` refuses them with `rule_inactive`. No
-- code path grants them today (`admin_ticket_reviews.ts` pays only
-- `task_approved`); this makes sure nothing can.
--
-- The rows stay, so the ledger's `rule_key` history and the Super Admin's rule
-- page still name them. The amounts are left as they were; only `active`
-- changes. A Super Admin can switch one back on from the rule page, which would
-- be a new decision. Idempotent: re-running sets the same value.
UPDATE credit_reward_rules
   SET active = 0, updated_at = datetime('now')
 WHERE key IN ('feature_shipped_high', 'feature_shipped_medium', 'feature_shipped_low');
