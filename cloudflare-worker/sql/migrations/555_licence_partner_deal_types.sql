-- 555 — Partner deal types per licence (D986, #2776, part 5 of #2376).
--
-- WHICH PARTNER DEAL TYPES A STUDIO MAY OFFER. `ALL_PARTNER_DEAL_TYPES`
-- (`cloudflare-worker/src/services/partnerDeals.ts`) is one list of five for
-- everyone; the canvas's GR3 lets HQ choose the subset each licence may
-- offer, and GR7 shows it to the studio as a locked card ("HQ sets these").
--
-- ONE ROW PER LICENCE, AND NO ROW IS "NOT RECORDED". A licence HQ never set
-- has no row and reads "Not recorded" — never "every type", which would pass
-- a default off as HQ's decision. What an unset licence may offer in the
-- meantime is D986 §3's rule, applied in code, not a value stored here.
-- `types_json` is a JSON array of the types allowed, in `ALL_PARTNER_DEAL_TYPES`
-- order; an empty array is a recorded decision that the studio offers none.
CREATE TABLE IF NOT EXISTS licence_partner_deal_types (
  licence_id         INTEGER PRIMARY KEY REFERENCES territory_licences(id),
  types_json         TEXT    NOT NULL CHECK (json_valid(types_json) AND json_type(types_json) = 'array'),
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at         TEXT    NOT NULL
);

-- THE BRANCH'S COPY rides the licence push, as the terms do (migration 512):
--   SQL NULL           a copy HQ pushed before this column existed
--   JSON 'null'        HQ has recorded no deal types for this licence
--   a JSON array       the types HQ allows
-- The branch's partner invitation write reads it (D986 §4).
ALTER TABLE branch_licence ADD COLUMN partner_deal_types_json TEXT;
