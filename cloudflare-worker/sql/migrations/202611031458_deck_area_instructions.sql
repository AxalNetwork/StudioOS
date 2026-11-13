-- D1521 (#3773, deck v2 A22): an instruction on the grid selection makes the
-- same area proposals as "Generate into areas" (D1512), and records what it
-- was asked. Named by its UTC minute (D4106); #3773 named this file 724.
--
--   selection_json      the areas the instruction was scoped to, as resolved
--                       ([{card_uid, area_id}]): the same on every row of the run
--   instruction_sha256  the hash of the founder's words (or of the action's name).
--                       The words themselves stay in the run's step input; a
--                       proposal never stores them
--   action              'instruction' for the founder's own words, else the
--                       action: shorten, expand, rewrite or more_visual
--
-- All three are null on a "Generate into areas" row. No figure is stored: an
-- instruction that names one is refused before any charge.
ALTER TABLE deck_area_proposals ADD COLUMN selection_json TEXT CHECK (selection_json IS NULL OR length(selection_json) <= 8192);
ALTER TABLE deck_area_proposals ADD COLUMN instruction_sha256 TEXT CHECK (instruction_sha256 IS NULL OR length(instruction_sha256) = 64);
ALTER TABLE deck_area_proposals ADD COLUMN action TEXT CHECK (action IS NULL OR action IN ('instruction', 'shorten', 'expand', 'rewrite', 'more_visual'));
