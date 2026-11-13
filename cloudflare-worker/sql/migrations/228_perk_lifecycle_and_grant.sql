-- 228 — when a perk stops, and what stopping takes back.
--
-- ══ THE `po2` ARTBOARD IS ABOUT A CONSEQUENCE, NOT A STATE ════════════════
--
-- Its blurb says so in one sentence: "some perks grant the redeemer something,
-- and when the perk expires that grant is revoked — so an expired row states
-- what it took back and on what date, rather than greying out." Its instMeta
-- says the same from the other side: "Expiry is an event with a consequence,
-- not a filter."
--
-- `perks` could express neither. It is `offer, kind, credits, price_cents,
-- claim_cap, status` — a listing with a review state and a cap, and no date on
-- it anywhere. So three of the artboard's four strip tiles and two of its four
-- chips had nothing to read, and `partnerZoneFilters.js` said exactly that in
-- `NO_PERK_EXPIRY`.
--
-- ══ TWO COLUMNS, AND THE TRAP THE FIRST ONE AVOIDS ════════════════════════
--
--   `ends_at` — the date the OFFER stops accepting redemptions.
--
--     THIS IS NOT `perk_claims.expires_at`, AND THE DISTINCTION IS THE WHOLE
--     REASON THE CHIPS WERE PROSE. `perk_claims.expires_at` is a deadline on
--     ONE founder's issued code. A reader could reasonably assume the listing
--     expires too — `NO_PERK_EXPIRY` was written to stop exactly that reading:
--     "the only expiry in this store is on a claim already issued to one
--     founder, which says nothing about the offer." One row per offer, one row
--     per claim, two different dates; this is the first of them.
--
--     NULL means open-ended, which is a real and common answer for a standing
--     discount. It is not "we forgot", so an open-ended perk reads `Live` and
--     never `Expiring`.
--
--   `grant_scope` — what a redeemer receives that OUTLIVES the redemption, and
--     which the offer's expiry takes back: "Priority queue access, 90 days",
--     "Studio Vireo partner tier, 6 months", "Trial seat scope — Board,
--     read-only".
--
--     NULL is the artboard's own fifth row, "Nothing beyond the discount": a
--     perk whose value is entirely spent at redemption. Its expiry revokes
--     nothing and its row says nothing was taken back, which is why the
--     `Grants revoked` tile counts redeemers of expired perks THAT CARRY A
--     GRANT rather than of every expired perk.
--
-- ══ THE REVOCATION DATE IS DERIVED, AND THAT IS THE POINT ═════════════════
--
-- The artboard shows `revokedOn` on its two expired rows, and on both it is the
-- same date as `ends`. So a `grant_revoked_at` column would be a second place
-- to store a fact `ends_at` already holds — and it would drift the first time
-- an expiry was edited and the revocation was not. That is precisely the call
-- migration 186 made about the credit balance in its own header: "a stored
-- balance is a second source of truth for a fact these rows already hold, and
-- it drifts the first time a write half-fails." A revoked grant is revoked ON
-- the day the offer ended, and the row can say so by reading one column.
--
-- ══ WHAT THIS DOES NOT CLAIM ══════════════════════════════════════════════
--
-- Nothing in this product ENFORCES a revocation. `grant_scope` is the firm's
-- own record of what a perk granted, so an expired row can state what it took
-- back; no scope is withdrawn from anybody by a background job, because none
-- runs. The zone says this in as many words rather than letting a red mark
-- imply an action the product did not take.
--
-- ══ SHAPES AND ENGINE FACTS ═══════════════════════════════════════════════
--
-- SQLite accepts a CHECK on an added column and refuses UNIQUE or PRIMARY KEY;
-- the GLOB below was run against the engine before this file was written, and
-- it refuses 'Oct 15 2026' while accepting '2026-10-15' and NULL. The format is
-- the one `datetime('now')` and every other date in this schema already use, so
-- a lexical comparison against `date('now')` is also a chronological one.
--
-- THE INDEX LEADS WITH THE COLUMN THIS FILE ADDS. `perks` is defined twice
-- (`186_perks.sql` and `schema_baseline.sql`), D1 keeps one table per name, and
-- an index naming a column only one definition carries cannot apply if the
-- other lineage won — the failure `check-migration-column-shapes` exists to
-- catch and the correction migrations 196 and 227 both made. A column an ALTER
-- in this file just added is present whichever shape won.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE perks
  ADD COLUMN ends_at TEXT
  CHECK (ends_at IS NULL OR ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

ALTER TABLE perks
  ADD COLUMN grant_scope TEXT;

-- `All`, `Live`, `Expiring` and `Expired` narrow one firm's perk book by where
-- each offer sits against today.
CREATE INDEX IF NOT EXISTS idx_perks_ends ON perks(ends_at);
