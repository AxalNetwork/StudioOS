-- 231 — the hours a person worked for the firm rather than for a client.
--
-- ══ WHY THE CAPACITY PAGE NEEDS A THIRD COLUMN ════════════════════════════
--
-- `engagement_hours` (208) is keyed on `engagement_id NOT NULL`, so every hour
-- it can hold is an hour worked against a named client. That is the whole book
-- of client work and it is not the whole week. Internal time — the firm's own
-- admin, recruiting, business development, the hour spent writing the proposal
-- nobody accepted — has nowhere to go, and the `pd3` artboard draws it as its
-- own column (`Internal h`) beside project and seat hours for a reason: it is
-- what makes `Total` a week rather than a billing summary.
--
-- The consequence of leaving it out is not cosmetic. Once a firm states a cap
-- (migration 230), "over cap" is a comparison against a total, and a total that
-- silently omits every unbilled hour under-reports every person by exactly the
-- part of their week the firm does not invoice. It would fail quietly and in
-- the reassuring direction — telling a stretched firm it has room — which is
-- the failure this bucket is least allowed to have.
--
-- ══ THE SAME CLASS OF FACT AS THE CAP ═════════════════════════════════════
--
-- Nothing here is derived. No timesheet, calendar or ticket system feeds this
-- table; a person or their manager states a number for a period, the same way
-- `engagement_hours` is stated. So an absent row is not zero: it means nobody
-- said, and the read keeps that distinction rather than adding a zero into a
-- total and calling it measured.
--
-- ══ SHAPE MIRRORS `engagement_hours`, MINUS THE ENGAGEMENT ════════════════
--
-- Same `(who, period, hours)` grain, same REAL hours, same one-row-per-period
-- uniqueness — because the two are summed together and a second grain would
-- make the addition wrong. `partner_id` rather than `engagement_id` is the
-- scope: internal work belongs to the firm, which is precisely what makes it
-- unattributable to a client.
--
-- `hours` is REAL for the same reason 208's is, and `check-money-cents` is
-- about money columns: this is not one. Zero is allowed and meaningful — "none
-- this period" is an answer somebody can give — while clearing the answer is a
-- DELETE, so the row's presence always means somebody stated something. The
-- upper CHECK is a month of wall-clock hours (31 × 24 = 744); a figure at or
-- above it is a typo, not a period.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS partner_internal_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  person_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- `YYYY-MM`, the same period label `engagement_hours` uses, because the two
  -- are added together per person per period.
  period TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours >= 0 AND hours < 744),
  -- What the time went on, in the firm's words. Optional, and never parsed.
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ONE STATEMENT PER PERSON PER PERIOD. Two rows would be two answers to one
-- question and the sum would quietly double somebody's week.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_internal_hours_period
  ON partner_internal_hours(partner_id, person_user_id, period);
