-- D6908 (#6908): the pro rata offer a company makes to one holder in its live
-- round, as the founder records it on the round manager (D366's
-- raise_pro_rata). Owner answer A on D6228: an investor reads their own offer.
--
--   offer_cents  the amount the holder may take up, in the row's currency.
--                NULL is "Offer not recorded"; it is never computed from the
--                holder's prior stake (D6908).
--   respond_by   the day the holder must answer by (YYYY-MM-DD), or NULL.
ALTER TABLE raise_pro_rata ADD COLUMN offer_cents INTEGER
  CHECK (offer_cents IS NULL OR (offer_cents > 0 AND offer_cents <= 1000000000000000));
ALTER TABLE raise_pro_rata ADD COLUMN respond_by TEXT
  CHECK (respond_by IS NULL OR respond_by GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
