-- 433 — the eight sample wellbeing experts stop being listed (D643, #1438).
--
-- Why: `ensureSeededExperts` (services/wellbeing/seedExperts.ts) inserted
-- eight SAMPLE experts on every expert-directory read, in production too, as
-- `verified = 1, is_active = 1` and with made-up booking links. On 2026-10-07
-- they were the only experts production held, and members saw all eight as
-- verified. From D643 the seed runs outside production only, and no member
-- read lists, opens or books a sample.
--
-- What: every expert whose uid starts with `seed_` (the seed's own prefix,
-- which no applied expert's generated uid can carry) is set inactive.
-- The rows are never deleted, so an audit can still see they existed and
-- what members were shown. Bookings and ratings that point at them stay.
--
-- Re-runnable: it only touches sample rows that are still active.

UPDATE experts
   SET is_active = 0,
       updated_at = datetime('now')
 WHERE substr(uid, 1, 5) = 'seed_'
   AND is_active = 1;
