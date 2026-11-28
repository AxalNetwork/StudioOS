-- D7929 (#7929): the forward fix for 202611281123_7929_sec_edgar_facts_source.sql. That migration only inserts one
-- source row (disabled) and its six catalogue rows; a Worker from before it has no sec-edgar-facts importer and reads
-- the rows as inert catalogue entries. So recovery needs no schema change: it keeps the source switched off, so
-- nothing can be imported for it until the Worker that knows it is back. Idempotent, and it deletes no row.
UPDATE research_market_sources SET enabled = 0 WHERE id = 'sec-edgar-facts';
