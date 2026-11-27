-- 380 — the EIF and EIFO flags say only what a fund's notable LPs say
-- (D539, #1084; owner call A, 2026-10-06).
--
-- THE BUG. Migration 365's importer set the EIF flag with a substring test,
-- `'EIF' in notable_lps`, and "EIFO" (Denmark's Export and Investment Fund)
-- contains "EIF": every EIFO-backed fund was also flagged as backed by the
-- European Investment Fund. Migration 378 then took both flags from two
-- unheaded spreadsheet columns (L and M), and column M is not EIFO. The owner
-- chose to recompute both from the LPs.
--
-- THE RULE, the same as `scripts/fund_lp_flags.py`:
--   EIF   "European Investment Fund", or EIF as a whole token: no ASCII
--         letter directly before or after it, so EIFO, EIFFEL and Seifert
--         do not match.
--   EIFO  EIFO as a whole token, or "Export and Investment Fund" (every
--         spelling the spreadsheet uses).
-- D1 has no REGEXP. The token test pads the text with a space at each end
-- and asks GLOB, which is case-sensitive, for the token between two
-- non-letters. The names use LIKE, which is case-insensitive for ASCII.
--
-- WHAT IT TOUCHES. `eif_flag` and `eifo_flag` on the EuroTech rows, and only
-- where the value changes, so a second run changes nothing. No other column
-- and no other source's rows.

UPDATE research_fund_directory
   SET eif_flag = CASE WHEN (' ' || COALESCE(notable_lps, '') || ' ') GLOB '*[^A-Za-z]EIF[^A-Za-z]*'
                         OR COALESCE(notable_lps, '') LIKE '%European Investment Fund%' THEN 1 ELSE 0 END,
       eifo_flag = CASE WHEN (' ' || COALESCE(notable_lps, '') || ' ') GLOB '*[^A-Za-z]EIFO[^A-Za-z]*'
                          OR COALESCE(notable_lps, '') LIKE '%Export and Investment Fund%' THEN 1 ELSE 0 END
 WHERE source_name = 'EuroTech VC Funds (public spreadsheet)'
   AND (eif_flag != CASE WHEN (' ' || COALESCE(notable_lps, '') || ' ') GLOB '*[^A-Za-z]EIF[^A-Za-z]*'
                           OR COALESCE(notable_lps, '') LIKE '%European Investment Fund%' THEN 1 ELSE 0 END
     OR eifo_flag != CASE WHEN (' ' || COALESCE(notable_lps, '') || ' ') GLOB '*[^A-Za-z]EIFO[^A-Za-z]*'
                           OR COALESCE(notable_lps, '') LIKE '%Export and Investment Fund%' THEN 1 ELSE 0 END);
