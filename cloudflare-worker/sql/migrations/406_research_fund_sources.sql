-- 406 — research_fund_sources: who published each public fund list, where it
-- is published, and the terms that govern reusing it, with a verdict and the
-- evidence behind it (D597, #1232; the owner's answer 2A on #1083, which D537
-- records).
--
-- One row per `research_fund_directory.source_name`. The Worker reads fund rows
-- only through `SERVED_FUNDS` (cloudflare-worker/src/services/researchFundDirectory.ts),
-- which leaves out every row of a list whose verdict here is 'not allowed'. So a
-- takedown is one UPDATE of `verdict` in a later migration, and no fund row is
-- deleted to make it.
--
--   verdict        'republish allowed': the quoted terms permit it.
--                  'cite only': served, with the list named and linked on every fund.
--                  'not allowed': the terms forbid republishing, so no row is served.
--   terms_status   'found' (terms_quote and evidence_url hold them) or 'not found'.
--                  Terms not found is never 'republish allowed' (the CHECK below).
--   repo_copy      the repo file the rows were imported from, or NULL when none is
--                  committed (repo_copy_note says why).
--
-- Reviewed 2026-10-06. None of the three lists' own pages could be opened from the
-- environment that wrote this file: its network policy refused docs.google.com and
-- hello-tomorrow.org. Each publisher and URL comes from the list's own title, the
-- header of the repo copy, and the web search index. No list states reuse terms in
-- the copy the repo holds, and the search index shows none. So all three are
-- 'not found' and 'cite only', as #1232 says, and the question is on #1232.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE, so a later
-- migration's change to a verdict is never overwritten.
CREATE TABLE IF NOT EXISTS research_fund_sources (
  source_name    TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  publisher      TEXT,
  published_url  TEXT,
  terms_status   TEXT NOT NULL CHECK (terms_status IN ('found', 'not found')),
  terms_quote    TEXT,
  evidence_url   TEXT,
  evidence       TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('republish allowed', 'cite only', 'not allowed')),
  verdict_reason TEXT NOT NULL,
  reviewed_on    TEXT NOT NULL CHECK (reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  repo_copy      TEXT,
  repo_copy_note TEXT,
  CHECK (terms_status = 'found' OR verdict <> 'republish allowed'),
  CHECK (terms_status = 'not found' OR (terms_quote IS NOT NULL AND evidence_url IS NOT NULL))
);

INSERT OR IGNORE INTO research_fund_sources
  (source_name, title, publisher, published_url, terms_status, terms_quote, evidence_url, evidence,
   verdict, verdict_reason, reviewed_on, repo_copy, repo_copy_note)
VALUES
  ('EuroTech VC Funds (public spreadsheet)',
   'Euro Tech VC Funds (from 1/2016)',
   '@Euro_VC',
   'https://docs.google.com/spreadsheets/d/1cRdFZhXLqat04xe7qO-p48wXQ00GWJyrzgHSb3YVIp0/edit',
   'not found', NULL,
   'https://docs.google.com/spreadsheets/d/1cRdFZhXLqat04xe7qO-p48wXQ00GWJyrzgHSb3YVIp0/edit',
   'The web search index titles this sheet "Euro Tech VC Funds (from 1/2016) - PLEASE READ FIRST TAB!" and summarises that first tab as a list of new tech VC funds in Europe and Israel, curated by @Euro_VC. It shows no licence or reuse terms. The sheet could not be opened here (docs.google.com refused by the network policy, 2026-10-06), so the first tab was not read word for word. The repo copy is Sheet1 only, and it states no terms.',
   'cite only',
   'Terms not found, so this list is cite only: every fund from it names the list and links to it.',
   '2026-10-06',
   'attached_assets/EuroTechVCFunds(from1_2016)-Sheet1.csv',
   'A byte-identical copy is also at attached_assets/Euro_Tech_VC_Funds_(from_1_2016)_-_Sheet1_1783956632756.csv. Migration 378 imported it.'),
  ('Deep Tech Investors Mapping (public spreadsheet)',
   'Deep Tech Investors Mapping - Public version',
   'Hello Tomorrow',
   'https://docs.google.com/spreadsheets/d/1BqNO7l4kXRhjG5jcB89FwRlhuRKBwBKtV7ZHwwLjPhk/edit',
   'not found', NULL,
   'https://docs.google.com/spreadsheets/d/1BqNO7l4kXRhjG5jcB89FwRlhuRKBwBKtV7ZHwwLjPhk/edit',
   'The header row of the repo copy names "Deep Tech Investors Mapping HT Investor Network" and says "Join our free Deep Tech Pioneers community" and "Join our Investor Network". Deep Tech Pioneers and the Investor Network are Hello Tomorrow programmes (hello-tomorrow.org/deep-tech-pioneers/ and hello-tomorrow.org/investor-network/, in the web search index). That header states no reuse terms, and the search index shows none. The sheet and hello-tomorrow.org could not be opened here (both refused by the network policy, 2026-10-06).',
   'cite only',
   'Terms not found, so this list is cite only: every fund from it names the list and links to it.',
   '2026-10-06',
   'attached_assets/Deep_Tech_Investors_Mapping_-_Public_version_-_Sheet1_1783956632757.csv',
   'Migration 378 imported it.'),
  ('Shai Goldman — new VC funds at/below $200M',
   'new VC funds at / below $200M in size by Shai Goldman @shaig',
   'Shai Goldman (@shaig)',
   'https://docs.google.com/spreadsheets/d/1ebGZ6-ivf_3woBGC4Kz_3217DhjGsefoRu_5iP3nuFQ/edit',
   'not found', NULL,
   'https://docs.google.com/spreadsheets/d/1ebGZ6-ivf_3woBGC4Kz_3217DhjGsefoRu_5iP3nuFQ/edit',
   'The web search index titles this sheet "new VC funds at / below $200M in size by Shai Goldman @shaig". It shows no licence or reuse terms. The sheet could not be opened here (docs.google.com refused by the network policy, 2026-10-06).',
   'cite only',
   'Terms not found, so this list is cite only: every fund from it names the list and links to it.',
   '2026-10-06',
   NULL,
   'Not in the repo, and never has been (D535, #1081). Production holds 987 rows under this name (S1 on #1081, 2026-10-04), loaded by an import that is not in the repo. No migration writes them.');
