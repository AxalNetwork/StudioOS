-- 542 / D897 / #2677: a New deck proposal carries its outline and the cards the founder kept.
-- Assigned by S1 on #2677, 2026-10-24. Additive: two nullable columns, nothing backfilled.
--
-- A New deck (PD3 to PD6) is one `pitch_deck_proposals` row from its outline
-- to its last kept card. No deck version is written until the founder keeps
-- cards (D720 §9: nothing is written to a record until the member accepts).
--
--   outline_json      what the deck is for and the rows it will build:
--                     {"audience", "round_ref", "length", "prompt", "start",
--                      "rows": [{"card", "title", "purpose"}], "proposed_by",
--                      "rail_proposal_uid"}. `audience` is one of migration
--                     539's values. NULL on a fill or a template proposal
--                     (D767, D778), which has no outline.
--   kept_slides_json  the indexes into `slides` the founder kept, ascending,
--                     e.g. [0,1,4]. NULL until the first Keep; Keep all keeps
--                     every index. The version written from them holds those
--                     cards only, in the proposal's order.

ALTER TABLE pitch_deck_proposals ADD COLUMN outline_json TEXT;
ALTER TABLE pitch_deck_proposals ADD COLUMN kept_slides_json TEXT;
