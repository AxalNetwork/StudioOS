-- D8771 (#8771): the deck export ledger records what each file carried.
--
-- Named by its UTC minute (D4106).
--
-- deck_exports (537, rebuilt by 754) gains, for a row written from now on:
--   notes    1 when the file carried the speaker notes, 0 when it did not
--   sources  1 when the file carried the Sources appendix, 0 when it did not
--   copy     the export dialog's preset those two make: 'investor' (no notes,
--            the appendix), 'working' (both) or 'custom' (anything else),
--            as `routes/deck_exports.ts` `copyOf` derives it
-- Every row written before this file keeps NULL in all three, which
-- `GET /api/decks/:id/exports` returns as null and the dialog says as
-- "Not recorded", never as "not included".
--
-- Additive: ADD COLUMN only. No row is changed.
ALTER TABLE deck_exports ADD COLUMN notes INTEGER CHECK (notes IS NULL OR notes IN (0, 1));
ALTER TABLE deck_exports ADD COLUMN sources INTEGER CHECK (sources IS NULL OR sources IN (0, 1));
ALTER TABLE deck_exports ADD COLUMN copy TEXT CHECK (copy IS NULL OR copy IN ('investor', 'working', 'custom'));
