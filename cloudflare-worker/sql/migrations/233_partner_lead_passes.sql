-- 233 — the leads a firm declined to bid on, and why.
--
-- ══ A PASS WITHOUT A REASON IS A LEAD YOU RE-EVALUATE NEXT QUARTER ════════
--
-- That sentence is the `p1` artboard's own, and it is the whole reason this
-- table exists. Nothing in this product records a decision NOT to bid. A need
-- the firm looked at and declined is indistinguishable from one nobody opened,
-- so the same lead comes back round, gets read again by somebody who was not in
-- the first conversation, and the firm spends the same hour twice. The
-- artboard's `Passed · with reasons` table is labelled "only here · the record
-- that stops re-litigation", and this is what it reads.
--
-- ══ A PASS IS NOT A LOSS, AND THE TWO MUST NOT MERGE ══════════════════════
--
-- The artboard is explicit: "a lost bid is on P2 with its reason; a pass is a
-- bid you chose not to make." A loss lives on `quotes` (the firm bid and the
-- client said no); a pass lives here (the firm never bid). Folding them would
-- flatter the win rate on P5 by removing the passes from the denominator — or
-- wreck it by adding them — depending which way somebody guessed. They are
-- different events about different decisions and they stay in different tables.
--
-- The read enforces the third part of that rule too: a need with a quote from
-- this firm is a PROPOSAL, a need with a row here is a PASS, and everything
-- else is an OPEN LEAD. The three sets share no member because each read
-- excludes the other two, not because a status column is kept in step by hand.
--
-- ══ THE REASONS ARE A CLOSED SET, AND THEY ARE THE ONES ALREADY IN USE ════
--
-- `partner_fit_rules` (209) already names why a firm says no: `budget_floor`,
-- `sector_declined`, `capability_absent`. The artboard's own passes read
-- "Below floor", "No capability", "Timing", and P5 counts losses by "Price",
-- "Scope mismatch", "Timing". This set is the union, so a pass can quote the
-- fit rule that produced it and P5 can group both tables by the same words.
-- `other` is here because a closed set with no escape hatch gets defeated by
-- somebody writing "timing" into a note that nothing can group.
--
-- ══ ONE PASS PER LEAD, AND IT CAN BE TAKEN BACK ═══════════════════════════
--
-- The unique index makes a second pass on one need impossible; the route
-- deletes rather than flagging, so a firm that passed in error puts the lead
-- back where it was. A `reversed_at` column would keep a row that says nothing
-- a reader needs — the lead is either passed or it is open.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS partner_lead_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  need_id INTEGER NOT NULL REFERENCES founder_needs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN (
    'below_floor', 'no_capability', 'scope_mismatch', 'timing', 'price', 'other'
  )),
  -- The sentence a person could send. Optional, because a reason on its own
  -- already stops the re-read; the note is what makes the pass useful to the
  -- next person who reads it.
  note TEXT,
  passed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ONE PASS PER LEAD PER FIRM. Two firms passing the same need is normal and
-- expected; one firm passing it twice is a duplicate, not a second decision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_lead_passes_need
  ON partner_lead_passes(partner_id, need_id);
-- The `Passed this quarter` tile and P5's loss-reason grouping read this way.
CREATE INDEX IF NOT EXISTS idx_partner_lead_passes_reason
  ON partner_lead_passes(reason, partner_id);
