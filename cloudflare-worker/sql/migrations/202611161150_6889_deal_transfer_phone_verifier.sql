-- D6889 (#6889): who confirmed a transfer's wire instructions by phone.
--
-- `deal_transfers.phone_verified` (migration 335) is a yes/no flag, and
-- `recorded_by` is the Admin who typed the record in. The closing workspace
-- (DX19) draws the person who made the call, who need not be the recorder.
-- `phone_verified_by` names that user. It is set only with
-- `phone_verified = 1`, and only to an Admin (the Worker refuses anything
-- else). Existing rows keep NULL: the verifier was never recorded for them,
-- and nothing is guessed from `recorded_by`.
--
-- Expand only: one nullable column, no backfill, nothing dropped.

ALTER TABLE deal_transfers ADD COLUMN phone_verified_by INTEGER REFERENCES users(id);
