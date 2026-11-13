-- 509 — token pack offers: a window for the bonus, and first-purchase packs (D790, #2215).
--
-- WHAT IS THERE ALREADY (486, D755). A pack's bonus is `ai_token_packs.bonus_microusd`
-- (at most 10% of face, by that table's CHECK). The bonus quoted at checkout is
-- stored on `ai_topup_purchases.bonus_microusd`, so an edit after payment never
-- changes a paid order, and the webhook credits it once as ledger kind `bonus`.
-- Refunds and disputes reverse credit + bonus in proportion. Nothing here
-- re-adds or changes any of that.
--
-- WHAT IT ADDS.
--   * On `ai_token_packs`:
--       offer_starts_at, offer_ends_at  when the bonus is offered: from start
--         (inclusive) to end (exclusive), either end open. ISO 8601 UTC with
--         milliseconds and a Z, as the Worker writes them (`toISOString`), so the
--         two compare as text. Both NULL: the bonus is offered whenever the pack
--         is on sale, as before.
--       first_purchase_only  1: sold only to a member with no credited pack.
--   * On `ai_topup_purchases`, fixed at checkout like the bonus:
--       first_purchase_only  the pack's flag when the order was quoted, so the
--         webhook's check follows the order paid, not a later edit.
--       bonus_withheld_microusd  the quoted bonus the webhook did not credit,
--         because the member had a credited pack by then (two checkouts racing).
--         `bonus_microusd` is set to 0 with it, so the reversal share stays the
--         credit actually given.
--
-- Grepped first: none of the five columns exists in schema_baseline.sql or an
-- earlier migration, and no open branch carries a 509.
--
-- Additive: nullable or defaulted columns, no table rebuilt, no backfill. SQLite's
-- ADD COLUMN is not re-runnable; the runner applies this file once.

ALTER TABLE ai_token_packs ADD COLUMN offer_starts_at TEXT;
ALTER TABLE ai_token_packs ADD COLUMN offer_ends_at TEXT;
ALTER TABLE ai_token_packs ADD COLUMN first_purchase_only INTEGER NOT NULL DEFAULT 0 CHECK (first_purchase_only IN (0, 1));
ALTER TABLE ai_topup_purchases ADD COLUMN first_purchase_only INTEGER NOT NULL DEFAULT 0 CHECK (first_purchase_only IN (0, 1));
ALTER TABLE ai_topup_purchases ADD COLUMN bonus_withheld_microusd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(bonus_withheld_microusd) = 'integer' AND bonus_withheld_microusd BETWEEN 0 AND 9007199254740991);
