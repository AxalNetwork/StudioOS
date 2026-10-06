# frontend/src/pages/research — zone bodies

The bodies `ResearchWorkspace` mounts for a slug, plus the pages that are not
zones: one record each, reached from a zone's list.

| File | What it is |
| --- | --- |
| `ResearchOverviewPanel.jsx` | The `/research` overview (Research · Main canvas, D536/D546), read from `GET /api/research/overview`. Not a zone: mounted inside the founder desk, the investor workspace and above the advisor and partner board. Each section is ok, Not recorded or Unreadable on its own; a missing count is never 0. |
| `AskZone.jsx` | Ask over owned documents, with saved/discarded disposition, use notes and owned citation links (D549). |
| `LibraryZone.jsx` | Owned and read-only client documents; kind/source-year editing and owned collections (D549). |
| `MarketZone.jsx` | Markets. |
| `MarketSectorProfile.jsx` | The sector route's entry point; an unmapped market keeps its existing profile. |
| `SectorProfile.jsx` | D547: tracked sectors inside `WorkspaceShell`, monthly live indexes with gaps, source mix, countries, funds, sub-markets and recorded build opportunities. Old market links redirect through the D533 crosswalk. |
| `BenchmarkingZone.jsx` | Investor benchmarking. Each metric links to its page. |
| `BenchmarkDetail.jsx` | `/research/benchmarking/:uid`. One benchmark: two figures neither coloured as better, the base first, named constituents (migration 303) whose count is never forced to match n, and a restatement Accept writes as the reading. |
| `benchmarkRead.js` | That page's tiles, draft and editor readings. A tracked row is Not recorded, never 0. |
| `DiligenceZone.jsx` | Investor diligence, assembled from room grants. Each company links to its room. |
| `DiligenceRoom.jsx` | `/research/diligence/:grantUid`. One room, read by the grant the investor holds. Behind an NDA is a count, never a name. Opening it is logged as opening the room. |
| `DiligenceFile.jsx` | `/research/diligence/:grantUid/files/:fileUid`. One document's facts and its download. A document behind an unsigned NDA has no name on the page. |
| `diligenceRead.js` | The size, date and file-state readings those two pages and their tests share. |
| `ClientPrepZone.jsx` | Advisor and partner client prep. |
| `FundsZone.jsx` | `/research/funds`. The fund directory (`FundDirectory.jsx`) above the founder shortlist. Stage, path and status stay three columns; a directory row enters the shortlist only through an explicit "Add to my list". |
| `FundDirectory.jsx` | The fund directory, to `Research · Funds` (D535): server search, filters, sort and paging over `GET /api/research/fund-directory`; coverage, the drawer, and the four states. A size shows only in a known currency; stage reads Not recorded. |
| `fundDirectoryRead.js` | That page's readings: "1–25 of N", the page list, a size only in a known currency, EIF/EIFO named, neither or unknown. |
| `FundCatalogProfile.jsx` | `/research/funds/catalog/:id`. One directory fund, inside `WorkspaceShell`. A failed read is Unreadable, a missing id says so. |
| `../../data/fundDirectory.json` | Deduplicated catalog of the attached Euro tech VC and deep-tech investor mapping exports, from `python3 scripts/build-fund-directory.py`. No page reads it since D535 steps 4–5: the directory is the Worker's (`research_fund_directory`). |
| `FundDossier.jsx` | `/research/funds/:uid`. One row. A blank cheque stays blank. The pre-meeting brief is drafted from this row on the press, and Accept appends it to the note; it does not email the fund. |
| `fundDossierRead.js` | The dossier's checklist and Last-updated readings. A fact no store holds is Not recorded, never a gap. |
| `CompanyAnalysis.jsx` | `/research/companies/:id`. One saved analysis. A save sends the title and the output, never the candidate set. The landscape read restates the page and Accept appends it to the notes. |
| `companyAnalysisRead.js` | That page's tiles, inputs row, feature grid and landscape read, in three shapes for a failed read, a failed run and a finished one. |
| `CompanyCandidate.jsx` | `/research/companies/:analysisId/:candidateId`. One competitor. A blank relevance stays blank. The draft restates the summary and the source titles. Back-links to its analysis. |
| `companyCandidateRead.js` | The readings that page and its tests share. |
| `CompanyDirectoryZone.jsx` | `/research/companies`. The company directory, searched, filtered, sorted and paged on the Worker (D534); it prints the API's total, coverage and facet counts, never a count of its own. A Saved analyses tab holds the competitor analyses and is where `/build/competitors` lands. |
| `CompanyProfile.jsx` | `/research/companies/company/:uid`. One directory company: metrics with source and date or Not recorded, market context, same-label competitors, funds by focus and HQ, signals, and the sources table. Each read fails on its own. |

The workspace chrome — crumb, zone pills, company chip — lives in
`frontend/src/workspaces/WorkspaceShell.jsx`, not in these files. A fit score
is not a field on this page.
