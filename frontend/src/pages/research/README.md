# frontend/src/pages/research — zone bodies

The bodies `ResearchWorkspace` mounts for a slug, plus the pages that are not
zones: one record each, reached from a zone's list.

| File | What it is |
| --- | --- |
| `AskZone.jsx` | Ask, over documents the caller uploaded. |
| `LibraryZone.jsx` | Those documents. |
| `MarketZone.jsx` | Markets. |
| `BenchmarkingZone.jsx` | Investor benchmarking. Each metric links to its page. |
| `BenchmarkDetail.jsx` | `/research/benchmarking/:uid`. One benchmark: two figures neither coloured as better, the base first, named constituents (migration 303) whose count is never forced to match n, and a restatement Accept writes as the reading. |
| `benchmarkRead.js` | That page's tiles, draft and editor readings. A tracked row is Not recorded, never 0. |
| `DiligenceZone.jsx` | Investor diligence, assembled from room grants. Each company links to its room. |
| `DiligenceRoom.jsx` | `/research/diligence/:grantUid`. One room, read by the grant the investor holds. Behind an NDA is a count, never a name. Opening it is logged as opening the room. |
| `DiligenceFile.jsx` | `/research/diligence/:grantUid/files/:fileUid`. One document's facts and its download. A document behind an unsigned NDA has no name on the page. |
| `diligenceRead.js` | The size, date and file-state readings those two pages and their tests share. |
| `ClientPrepZone.jsx` | Advisor and partner client prep. |
| `FundsZone.jsx` | The founder shortlist at `/research/funds`. Stage, path and status stay three columns; the read-only fund directory below it is generated from the attached public mapping exports and only enters a founder's shortlist after an explicit Add. |
| `../../data/fundDirectory.json` | Deduplicated catalog of the attached Euro tech VC and deep-tech investor mapping exports. Refresh with `python3 scripts/build-fund-directory.py`; records are source-backed discovery data, not endorsements or a live market feed. |
| `FundDossier.jsx` | `/research/funds/:uid`. One row. A blank cheque stays blank. The pre-meeting brief is drafted from this row on the press, and Accept appends it to the note; it does not email the fund. |
| `fundDossierRead.js` | The dossier's checklist and Last-updated readings. A fact no store holds is Not recorded, never a gap. |
| `CompanyAnalysis.jsx` | `/research/companies/:id`. One saved analysis. A save sends the title and the output, never the candidate set. The landscape read restates the page and Accept appends it to the notes. |
| `companyAnalysisRead.js` | That page's tiles, inputs row, feature grid and landscape read, in three shapes for a failed read, a failed run and a finished one. |
| `CompanyCandidate.jsx` | `/research/companies/:analysisId/:candidateId`. One competitor. A blank relevance stays blank. The draft restates the summary and the source titles. Back-links to its analysis. |
| `companyCandidateRead.js` | The readings that page and its tests share. |

The workspace chrome — crumb, zone pills, company chip — lives in
`frontend/src/workspaces/WorkspaceShell.jsx`, not in these files. A fit score
is not a field on this page.
