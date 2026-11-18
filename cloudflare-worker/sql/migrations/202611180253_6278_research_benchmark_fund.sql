-- D6278 (#6278): a benchmark's "Ours" may come from a fund's recorded figure.
--
-- The owner's answer on #6278 (2026-11-15): yes, a benchmark may carry an
-- optional fund reference, and "Use the recorded figure" fills "Ours" without
-- overwriting a typed value. Every existing row keeps NULL in all three columns
-- and reads exactly as before: "As entered on this row".
--
-- fund_id         the fund the figure was taken from. A fund that is deleted
--                 clears the link; the text in our_value stays as written.
-- our_value_metric which recorded figure filled our_value: TVPI or DPI. NULL
--                 means our_value was typed (or is empty), never "from a fund".
-- our_value_as_of the date the fund's figure was read for (YYYY-MM-DD), so the
--                 page says when the number was true rather than implying now.
--
-- A hand edit of our_value clears both our_value columns and the link (the
-- route does that), so a typed figure is never shown as the fund's.
--
-- Additive; the ledger applies each ALTER once. No transaction statements: D1
-- rejects `BEGIN;`/`COMMIT;` (see 200's header).
ALTER TABLE research_benchmarks ADD COLUMN fund_id INTEGER REFERENCES vc_funds(id) ON DELETE SET NULL;
ALTER TABLE research_benchmarks ADD COLUMN our_value_metric TEXT
  CHECK (our_value_metric IS NULL OR our_value_metric IN ('tvpi', 'dpi'));
ALTER TABLE research_benchmarks ADD COLUMN our_value_as_of TEXT;
