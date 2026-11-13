-- 413 — reviewed fund-list terms from GitHub runner evidence (D597, #1232).
-- Only quoted evidence is committed; no full fetch or contact lines.
-- 406 is applied and unchanged. Older reviews update once; replay preserves later reviews.

UPDATE research_fund_sources SET
  terms_status = 'not found',
  terms_quote = 'All info is publicly available, unless a fund has deliberately reached out to provide the info.
No, I won''t share editing rights for you to copy & paste the data.',
  evidence_url = 'https://docs.google.com/spreadsheets/d/1cRdFZhXLqat04xe7qO-p48wXQ00GWJyrzgHSb3YVIp0/gviz/tq?tqx=out:csv',
  evidence = 'Runner 37646578399 fetched the notes tab on 2026-10-07. The quoted notes describe availability and decline editing rights; neither grants a reuse licence nor expressly forbids republication. No reuse terms found in the fetched notes.',
  verdict = 'cite only',
  verdict_reason = 'Terms not found in the reviewed notes. Public availability is not a reuse licence; every fund cites and links this list.',
  reviewed_on = '2026-10-07'
WHERE source_name = 'EuroTech VC Funds (public spreadsheet)' AND reviewed_on < '2026-10-07';

UPDATE research_fund_sources SET
  terms_status = 'found',
  terms_quote = 'These Terms and Conditions constitute a legally binding agreement made between you, whether personally or on behalf of an entity (“you”) and Hello Tomorrow SAS (“we,” “us” or “our”), concerning your access to and use of the hello-tomorrow.org website as well as any other media form, media channel, mobile website or mobile application related, linked, or otherwise connected thereto (collectively, the “Site”).

The Content and the Marks are provided on the Site “AS IS” for your information and personal use only. Except as expressly provided in these Terms and Conditions, no part of the Site and no Content or Marks may be copied, reproduced, aggregated, republished, uploaded, posted, publicly displayed, encoded, translated, transmitted, distributed, sold, licensed, or otherwise exploited for any commercial purpose whatsoever, without our express prior written permission.',
  evidence_url = 'https://hello-tomorrow.org/website-terms-and-conditions/',
  evidence = 'Runner 37646578399 fetched the introduction, signed by the Hello Tomorrow Team: "We are happy to share with you our list of international investors in Deep Tech (DT)!" Runner 37646442641 fetched the publisher website terms on 2026-10-07. Their Site definition includes related or linked media; its commercial-republication restriction applies to this publisher mapping. The introduction gives no express commercial reuse permission.',
  verdict = 'not allowed',
  verdict_reason = 'Hello Tomorrow restricts commercial republication without express prior written permission. The public mapping gives no such permission, so this list is removed.',
  reviewed_on = '2026-10-07'
WHERE source_name = 'Deep Tech Investors Mapping (public spreadsheet)' AND reviewed_on < '2026-10-07';

UPDATE research_fund_sources SET
  title = 'new VC funds at / below $200M in size by Shai Goldman',
  publisher = 'Shai Goldman',
  terms_status = 'not found',
  terms_quote = 'sorted by year raised as this is a resource for founders who are raising capital.  The more recent the fund was raisied, the more capital the VC firm tends to have available for new investments',
  evidence_url = 'https://docs.google.com/spreadsheets/d/1ebGZ6-ivf_3woBGC4Kz_3217DhjGsefoRu_5iP3nuFQ/edit',
  evidence = 'Runner 37645260003 fetched the sheet on 2026-10-07. Its notes describe a resource for founders by year raised; no reuse licence or republication restriction was found. Contact lines are excluded. The data file is pending the separate #1081 import.',
  verdict = 'cite only',
  verdict_reason = 'Terms not found in the reviewed sheet notes. Every fund cites and links the list; public access is not permission to republish.',
  repo_copy_note = 'The runner fetched the source file. It is not committed here; the separate #1081 import follows this review, with contact lines excluded.',
  reviewed_on = '2026-10-07'
WHERE source_name = 'Shai Goldman — new VC funds at/below $200M' AND reviewed_on < '2026-10-07';
