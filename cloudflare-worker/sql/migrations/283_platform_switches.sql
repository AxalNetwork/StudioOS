-- 283 — the operator switch store: HQ can switch Eadwyn off without a deploy (D203).
--
-- THE GAP, as D202 left it. HQ · Platform lists the platform's switches, and
-- every one of them was set at deploy: switching Eadwyn off meant changing a
-- Worker variable (ADVISOR_V2_DISABLED / ADVISOR_DISABLED) and redeploying,
-- which is a GitHub push and a CI run in the middle of an incident. The
-- Feature flags console said so in words — "no operator store" — and this
-- table is the store it said was missing.
--
-- ONE ROW PER SWITCH, AND A ROW CAN ONLY SWITCH SOMETHING OFF. `thrown = 1`
-- means an operator has thrown that switch's kill. The effective state is the
-- deploy switch OR this row, so the store can add a kill and release its own,
-- and it can never release a kill the deployment set, nor switch a capability
-- ON. That is the point of the shape rather than a limitation of it: a store
-- that could turn things on is how charging, tax or the queue would come to be
-- switched on at runtime by a row nobody reviewed.
--
-- THE KEY HAS NO CHECK CONSTRAINT, on purpose. The worker admits the keys it
-- knows (services/operatorSwitches.ts, OPERATOR_SWITCH_KEYS) and refuses every
-- other one before it writes. A CHECK here would make adding the second
-- switch a table rebuild, because SQLite cannot alter one — D139 had to
-- rebuild `licence_events` to widen exactly that kind of list.
--
-- HISTORY LIVES IN admin_audit_log, NOT HERE. Every throw and release writes
-- one row there through logAdminAction, with the reason, and that table has
-- been append-only since migration 269. This row is the CURRENT state only;
-- a second ledger beside the audit log would be the tile-versus-table
-- disagreement D128 ended, one store over.
--
-- `reason` is NOT NULL because every write carries one — the route refuses a
-- throw or a release without it, and the reason for the current state is the
-- first thing an operator asks. `set_by_user_id` has no foreign key for the
-- reason migration 282 gives: an ON DELETE action would run an UPDATE the
-- audit seal forbids, and no account-deletion path exists (D168).
--
-- `set_at` is SQLite's own clock, `YYYY-MM-DD HH:MM:SS`, the format every
-- reader of this table expects. Nothing compares it against a deadline.
--
-- No BEGIN / COMMIT (D1 rejects them — the migration 200 lesson), no seed
-- rows: an absent row is a switch nobody has thrown, which is the state a
-- fresh deployment should be in.

CREATE TABLE IF NOT EXISTS platform_switches (
  switch_key      TEXT    PRIMARY KEY,
  thrown          INTEGER NOT NULL CHECK (thrown IN (0, 1)),
  reason          TEXT    NOT NULL,
  set_by_user_id  INTEGER,
  set_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
