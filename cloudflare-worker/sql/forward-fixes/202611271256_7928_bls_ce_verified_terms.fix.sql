-- D7928-p2 (#7928): the forward fix for 202611271256_7928_bls_ce_verified_terms.sql. That migration rewrites only the
-- text of the bls-ce source row and of its CV catalogue definitions; a Worker from before it reads the same columns
-- and never parses that text. So recovery needs no schema change: it keeps the source switched off, so nothing is
-- imported for it until the Worker that reads the real table layout is back. Idempotent, and it deletes no row.
UPDATE research_market_sources SET enabled = 0 WHERE id = 'bls-ce';
