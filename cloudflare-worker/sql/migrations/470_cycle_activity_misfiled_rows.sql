-- 470 — D690 (#1690): re-file the activity rows #1736 misfiled in production.
--
-- #1736 merged at 2026-10-17 16:32Z and deployed at 16:50Z, before S1's review
-- findings on it were fixed. Two of those findings wrote rows that no later
-- code can correct, because activity rows are never rewritten (D-e). This is
-- the one-off correction S1 ruled for the rows written in that window, and it
-- touches nothing else: every statement is bounded to rows created on or
-- after 2026-10-17 16:00:00, before the deploy.
--
-- 1. MODULE-LEVEL WRITES LOGGED UNDER A RECORD. The monthly interviews target,
--    the waitlist target, the market readiness marks and the market sources
--    belong to a module, not to a record, and logged the project's id as their
--    `entity_id`. A record whose id equals that number (an interview, or a
--    candidate whose client-set id is that number) then showed them in its own
--    history. S1's ruling: a module-level write logs `entity_id` NULL, which no
--    record read can match. The action names are the writers' own
--    (`services/validateWriters.ts`): setInterviewsTarget, setWaitlistTarget,
--    setMarketMark, addMarketSource and removeMarketSource. Only a row whose
--    `entity_id` is exactly its own project's id is changed. A competitor
--    row (`competitor_mention_written`, `competitor_created`) whose candidate
--    id failed the pattern also logged the project's id, but it is left as it
--    is: a candidate whose own valid id is that number logs the same row, and
--    the two cannot be told apart.
UPDATE activity_logs
   SET entity_id = NULL
 WHERE entity_type IN ('validate.customer-research', 'validate.demand-signals', 'validate.market-intelligence')
   AND action IN ('interviews_target_set', 'interviews_target_cleared',
                  'waitlist_target_set', 'waitlist_target_cleared',
                  'market_mark_set', 'market_source_added', 'market_source_removed')
   AND entity_id = CAST(project_id AS TEXT)
   AND datetime(created_at) >= datetime('2026-10-17 16:00:00');

-- 2. SEGMENT CREATES LOGGED UNDER A MODULE THAT DOES NOT EXIST. writeSegment
--    logged `validate.customer-segments`; a segment's record is in Ideal
--    customer profile, where its links already log, so the create row never
--    reached the segment's own history. Its `entity_id` (the segment's id) and
--    its other columns are already right and stay as they are.
UPDATE activity_logs
   SET entity_type = 'validate.ideal-customer-profile'
 WHERE entity_type = 'validate.customer-segments'
   AND datetime(created_at) >= datetime('2026-10-17 16:00:00');
