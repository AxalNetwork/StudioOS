-- D4086 (#4086, #4087; a follow-up to D1564 / #3811): the securities
-- exemption a round is offered under, recorded on the round itself.
--
-- `exemption` is the founder's own statement, set in Raise › Capital
-- relationships › Round settings. NULL means not recorded: the column has no
-- default, and rounds already on file stay NULL until the founder sets it (no
-- backfill guess). The list is a proposal for counsel to confirm:
--   506b    Rule 506(b): no general solicitation, so a deck never publishes;
--   506c    Rule 506(c): general solicitation allowed (verified accredited);
--   reg_cf  Regulation Crowdfunding;
--   reg_s   Regulation S (offshore);
--   other   anything else the founder relies on.
--
-- Publishing a deck (`routes/deck_publish.ts`) reads it from the deck's round
-- (`pitch_decks.round_ref` → `raise_rounds.uid`) instead of a per-link
-- statement.
--
-- Additive; no BEGIN/COMMIT (D1 applies a file as one batch).

ALTER TABLE raise_rounds ADD COLUMN exemption TEXT
  CHECK (exemption IS NULL OR exemption IN ('506b', '506c', 'reg_cf', 'reg_s', 'other'));
