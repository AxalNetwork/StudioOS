-- D5359 (#5359) — one accepted quote per founder need.
--
-- Fail closed on legacy duplicates. HQ's production pre-check on 2026-11-09
-- found none. A branch database that does contain duplicates must stop here
-- for operator review; this migration does not guess which commercial
-- acceptance is authoritative by silently rejecting another row.

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_one_accepted_per_need
  ON quotes(need_id)
  WHERE status = 'accepted';

