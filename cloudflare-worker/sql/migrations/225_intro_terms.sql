-- 225 — what an introduction is FOR, and what came of it.
--
-- ══ WHAT `intro_propositions` ALREADY HOLDS, AND THE TWO THINGS IT DOES NOT ══
--
-- Migration 150's `intro_propositions` is a better store than the page over it
-- ever showed. It holds BOTH sides of the consent: the counterpart's decision
-- is the mirror row (`source = 'reciprocal'`, owned by `target_user_id`), so
-- "Dev agreed Aug 27 · Verwood not recorded" is a fact the database has always
-- had and the response has never returned. The `pn2` artboard's `Consent
-- record` column and its `At a gate` tile both wait on returning it, which is a
-- read-shape fix and not a migration.
--
-- Two things are genuinely absent, and this table is both:
--
--   1. WHETHER IT IS A FAVOUR OR A REFERRAL WITH A FEE. The artboard's blurb:
--      "For a partner firm an introduction often carries economics, so every row
--      states whether it is a favour or a referral with a fee attached." Its
--      `With economics` tile counts exactly this, and `intro_propositions` has
--      no column that could hold it — `breakdown_json` is the matching engine's
--      own output and writing terms into it would be a firm's commercial
--      agreement stored inside a score explanation.
--
--   2. WHETHER IT WAS ACTUALLY MADE, AND WHAT CAME OF IT. `status = 'accepted'`
--      means "this side consented", which is the fourth step of five. The
--      artboard's `Made` state and its `Where it stands` column are about the
--      introduction having happened and produced something: "Engaged Ostara for
--      native mobile — 8% referral fee agreed."
--
-- ══ OWNER-SCOPED, BECAUSE AN AGREEMENT HAS TWO ACCOUNTS OF IT ══════════════
--
-- A proposition is a pair of rows, one per side. So is this: each party records
-- its own terms against its own row, and neither writes on the other's. That is
-- not a limitation to route around — a referral fee the counterpart has not
-- agreed to is one firm's claim, and storing it as a shared fact would let one
-- side's number appear on the other side's screen as though both had signed it.
--
-- ══ A REFERRAL WITHOUT A FEE IS THE AMBIGUITY THIS EXISTS TO REMOVE ════════
--
-- `CHECK (kind = 'favour' OR fee_bps IS NOT NULL)` — the same refusal
-- `research_benchmarks` (217) makes of a peer figure with no sample size, and
-- 223's of a range with no comparable count. If a row may say "referral" while
-- leaving the fee blank, then `With economics` counts rows that state no
-- economics, and a reader cannot tell a fee of zero from a fee nobody wrote
-- down. The converse check is the same rule from the other side: a favour with
-- a fee on it is not a favour.
--
-- BASIS POINTS, INTEGER. A referral fee is a percentage of something not yet
-- known, so it is a rate and not an amount — `user_company_links.carry_bps` is
-- the precedent in this schema, and `check-money-cents` is satisfied because
-- there is no money column here at all.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS intro_terms (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  -- The caller's OWN proposition row. Not the pair, and not the counterpart's
  -- mirror: this is one side's record of what it thinks the introduction is.
  proposition_uid   TEXT NOT NULL,
  owner_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'favour'   — no economics, and the row says so rather than staying silent.
  -- 'referral' — a fee is attached, and `fee_bps` states it.
  kind              TEXT NOT NULL CHECK (kind IN ('favour', 'referral')),
  -- Basis points: 800 is the artboard's 8%.
  fee_bps           INTEGER,
  -- WHEN THE INTRODUCTION WAS ACTUALLY MADE, which is a different event from
  -- either consent and the only thing that distinguishes the artboard's `Made`
  -- state from `Both agreed`. NULL until it happens.
  made_at           TEXT,
  -- What came of it, in the firm's own words — the `Where it stands` column.
  outcome           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- One record per side per introduction.
  UNIQUE (owner_user_id, proposition_uid),
  -- A referral has to say what the fee is; a favour has to have none.
  CHECK (kind = 'favour' OR fee_bps IS NOT NULL),
  CHECK (kind = 'referral' OR fee_bps IS NULL),
  -- 10000 bps is the whole of it. A fee of zero is a favour, and it has a word.
  CHECK (fee_bps IS NULL OR (fee_bps > 0 AND fee_bps <= 10000))
);

-- "My terms, for the introductions on screen" is the only read: the page loads
-- its propositions and joins this by owner.
CREATE INDEX IF NOT EXISTS idx_intro_terms_owner
  ON intro_terms(owner_user_id, proposition_uid);
