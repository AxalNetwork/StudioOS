-- 322_perk_value_editorial_redemption_ratings.sql — Perks & Products: the
-- facts the canvas draws that no column held (D412, wave 8, Session 13).
--
-- The Perks & Products canvas draws, per listing, a cash value ("$2,400
-- value"), an editorial quote on the "Featured this month" cards, a star
-- rating or "Not yet rated", and — on the partner's Performance tab — who
-- redeemed and a redemption rate. Migrations 186, 198 and 228 hold none of
-- those, and nothing ever wrote a claim's `redeemed` state, so each was either
-- a canvas fixture or nothing. This adds the smallest store for each:
--
--   perks.value_cents          INTEGER  — the partner's stated cash value of
--                                         the offer, in integer cents (never a
--                                         float; scripts/check-money-cents.mjs).
--                                         Distinct from price_cents, which is
--                                         what a 'money' perk COSTS; this is
--                                         what any perk is WORTH, and it is a
--                                         partner claim, reviewed like the rest
--                                         of the listing.
--   perks.editorial_note       TEXT     — Axal's own quote for a featured
--                                         listing. Written only by the admin
--                                         review route, never by the partner:
--                                         an endorsement the partner can edit
--                                         is not an editorial.
--   perk_claims.redeemed_by_user_id INTEGER — who marked a claim redeemed.
--                                         The partner marks it (the founder's
--                                         redemption happens on the partner's
--                                         side, where Axal cannot see it), and
--                                         a write on another account's claim
--                                         records its actor.
--   perk_ratings               TABLE    — one rating per (perk, founder), 1-5.
--                                         Who may rate is a rule in
--                                         routes/perks.ts (PERK_RATING_REQUIRES),
--                                         not here: today, only a founder whose
--                                         claim of that perk was redeemed.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   * no "instant" fulfilment — the canvas's fourth redeem method. The
--     `fulfilment` CHECK (186) cannot be altered in place in SQLite, and a
--     table rebuild of `perks` for one enum value is not worth its risk;
--     the partner form offers the three methods the column accepts.
--   * no card-impression counter. `perk_views` counts detail opens, one per
--     viewer per day, and stays the only view figure.
--   * no stored rating average. It is derived on read, like the balance.
--
-- STANDS ALONE: additive columns and one new table, depending on no other
-- wave-8 migration. NON-IDEMPOTENT for the three ALTERs (D1's ALTER TABLE has
-- no IF NOT EXISTS). Apply through the ledger-driven runner, which runs it
-- exactly once:
--
--   npm run d1:migrate:remote

ALTER TABLE perks ADD COLUMN value_cents INTEGER CHECK (value_cents IS NULL OR value_cents >= 0);

ALTER TABLE perks ADD COLUMN editorial_note TEXT;

ALTER TABLE perk_claims ADD COLUMN redeemed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS perk_ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    perk_id     INTEGER NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ratings_once ON perk_ratings(perk_id, user_id);
