-- 230 — the weekly hours a firm says its people have.
--
-- ══ THE REFUSAL THIS REPLACES, AND WHY IT WAS RIGHT ═══════════════════════
--
-- `routes/partner_delivery.ts` has answered `cap_hours: null` since it was
-- written, with a reason in the response: "No capacity cap is recorded anywhere
-- in this product. Hours are real; a threshold to be over is not, so nothing
-- here is marked over-committed." Its own header spells out what it was
-- refusing: the `pd3` canvas hardcodes `CAP_H = 40`, and "adopting that number
-- would be inventing the firm's cap and then presenting it as a finding."
--
-- That was exactly right, and it stays right about the canvas's forty. What it
-- was never a reason for is refusing a cap the FIRM ITSELF STATES. A number a
-- firm writes down about its own week is the same class of fact as the budget
-- floor in `partner_fit_rules`: not computed, not inferred, not borrowed from a
-- design fixture — asserted by the people it describes, and quotable back to
-- them. The canvas's forty is a number about somebody else's firm; this is a
-- number about this one.
--
-- ══ ONE TABLE, TWO SCOPES, AND `person_user_id IS NULL` IS THE FIRM ═══════
--
-- A firm-wide default plus a per-person override is two facts of the same
-- shape, and a second table for the second one would need its own precedence
-- rule in every reader. So a row with NULL `person_user_id` is the firm's
-- default and a row naming somebody is theirs; the read prefers the specific.
-- The partial unique indexes below make each of the two unambiguous — SQLite
-- treats NULLs as distinct in a plain UNIQUE, so `UNIQUE (partner_id,
-- person_user_id)` alone would let a firm store six different defaults.
--
-- ══ NO CAP IS STILL A REAL ANSWER, AND THE COMMONEST ONE ══════════════════
--
-- Every firm starts with no row here, and the zone must keep saying so: an
-- absent cap reads absent, `Over-committed` stays uncountable, and nothing is
-- marked red against a threshold nobody set. This migration gives the firm
-- somewhere to put an answer; it does not put one there.
--
-- ══ HOURS, NOT MONEY ══════════════════════════════════════════════════════
--
-- `weekly_hours` is REAL because `engagement_hours.hours` is REAL and the two
-- are compared directly; `check-money-cents` is about money columns and this is
-- not one. The CHECK keeps it positive and inside a week that exists — a
-- hundred and sixty-eight hours is every hour there is, and a cap at or above
-- it is a typo rather than a policy.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS partner_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  -- NULL = the firm's default for anybody with no row of their own.
  person_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  weekly_hours REAL NOT NULL CHECK (weekly_hours > 0 AND weekly_hours < 168),
  -- Why this number, in the firm's words. Shown beside the cap so a reader can
  -- see what it means rather than only what it is: "four days, one for
  -- internal" is a different cap from "forty, and we mean it".
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ONE DEFAULT PER FIRM, and one override per person. Two partial indexes rather
-- than one plain UNIQUE, because SQLite treats NULLs as distinct: a plain
-- `UNIQUE (partner_id, person_user_id)` would admit any number of firm defaults
-- and leave the read picking one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_capacity_default
  ON partner_capacity(partner_id) WHERE person_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_capacity_person
  ON partner_capacity(partner_id, person_user_id) WHERE person_user_id IS NOT NULL;
