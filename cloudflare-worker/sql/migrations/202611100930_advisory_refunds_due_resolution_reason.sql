-- D4703 (#5305): an operator marks an advisory refund due resolved, and says
-- why. `resolved_at` and `resolved_by` already exist (202611070915); the
-- reason did not. Existing rows keep NULL: none was resolved before #5305,
-- because no route wrote `resolved_at`.
--
-- Recording the reason moves no money. The refund itself is made by an
-- operator outside the platform (the owner's decision, 2026-11-07).
ALTER TABLE advisory_refunds_due ADD COLUMN resolution_reason TEXT;
