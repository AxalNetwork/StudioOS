-- 229 — how strong a fit a profile is, in the firm's own judgement.
--
-- ══ THE CHIP REASONS HERE MISREAD THEIR OWN ARTBOARD ══════════════════════
--
-- `po5`'s chips are `All · Best fit · Qualified · Weak`, and two of them were
-- prose in `partnerZoneFilters.js` on this reasoning:
--
--   "no lead is scored against these rules — the worker answers
--    `enforcement: 'none'` — so nothing here is qualified or not"
--
-- That is exactly right about LEADS and it is not what the artboard's chips
-- select. Look at its own rows: "Series A companies without design leadership —
-- Qualified", "Pre-product founders with a deck — Weak intent". Those are not
-- scores computed about anybody. They are the FIRM'S OWN judgement about a kind
-- of client, written down beside the profile — and its instNote turns on the
-- distinction: "Pre-product founders read as weak intent rather than declined,
-- because the honest answer is 'not yet' — and a match engine that cannot say
-- 'not yet' ends up saying 'no' to the same founder twice."
--
-- A firm's own words about a kind of client are storable. A score about a
-- particular founder is not, and this migration does not add one:
-- `enforcement: 'none'` stays exactly as true after it as before.
--
-- ══ WHY A SECOND COLUMN AND NOT A FIFTH `kind` ════════════════════════════
--
-- `kind` answers WHICH KIND OF RULE this is: a profile the firm wrote about who
-- it is for (`best_fit`), or one of the three exclusions the anti-persona card
-- is built from. `signal` answers HOW STRONG a fit that profile is. They are
-- different questions and folding them into one CHECK would make
-- `sector_declined` and `weak_intent` look like alternatives, when the whole
-- point of the artboard's "not yet" is that a weak profile is NOT a decline.
--
-- The name `best_fit` reads oddly beside `signal = 'weak_intent'`, and that is
-- the price of not churning a CHECK five call sites read. `kind = 'best_fit'`
-- means "a profile row" here; the strength is `signal`.
--
-- NULLABLE, AND NULL IS NOT `best_fit`. A profile the firm has not graded reads
-- ungraded — it answers to `All` and to no strength chip. Defaulting it would
-- have the store put a judgement in the firm's mouth, and the strongest of the
-- three at that.
--
-- MEANINGFUL ONLY ON A PROFILE. An exclusion has no strength: a declined sector
-- is declined. The route refuses a signal on any other kind rather than storing
-- one nothing reads — a CHECK cannot say that here, because a CHECK on an added
-- column may not reference another column.
--
-- SQLite accepts a CHECK on an added column and refuses UNIQUE or PRIMARY KEY;
-- this is a CHECK, verified against the engine as 226's header notes.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE partner_fit_rules
  ADD COLUMN signal TEXT
  CHECK (signal IS NULL OR signal IN ('best_fit', 'qualified', 'weak_intent'));

-- `Best fit`, `Qualified` and `Weak` narrow one firm's profiles by strength.
--
-- THE INDEX LEADS WITH THE COLUMN THIS FILE ADDS rather than with
-- `(partner_id, signal)`, which is the shape a reader reaches for first.
-- `partner_fit_rules` is defined in `209_partner_offers_stores.sql` and again in
-- the baseline, D1 keeps one table per name, and an index naming a column only
-- one definition carries cannot apply if the other lineage won — the failure
-- `check-migration-column-shapes` exists to catch and the correction migrations
-- 196, 227 and 228 all made. A column an ALTER in this file just added is
-- present whichever shape won.
CREATE INDEX IF NOT EXISTS idx_partner_fit_rules_signal
  ON partner_fit_rules(signal);
