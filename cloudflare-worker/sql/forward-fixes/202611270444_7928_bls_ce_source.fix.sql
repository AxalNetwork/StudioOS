-- D7928 (#7928): the forward fix for 202611270444_7928_bls_ce_source.sql. That migration only inserts one source row
-- (disabled) and its 27 catalogue rows; a Worker from before it has no bls-ce importer and reads the rows as inert
-- catalogue entries. So recovery needs no schema change: it keeps the source switched off, so nothing can be imported
-- for it until the Worker that knows it is back. Idempotent, and it deletes no row.
UPDATE research_market_sources SET enabled = 0 WHERE id = 'bls-ce';
