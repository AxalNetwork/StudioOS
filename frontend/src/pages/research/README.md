# frontend/src/pages/research — zone bodies

The bodies `ResearchWorkspace` mounts for a slug, plus the pages that are not
zones: one record each, reached from a zone's list.

| File | What it is |
| --- | --- |
| `AskZone.jsx` | Ask, over documents the caller uploaded. |
| `LibraryZone.jsx` | Those documents. |
| `MarketZone.jsx` | Markets. |
| `BenchmarkingZone.jsx` | Investor benchmarking. |
| `DiligenceZone.jsx` | Investor diligence, assembled from room grants. Each company links to its room. |
| `DiligenceRoom.jsx` | `/research/diligence/:grantUid`. One room, read by the grant the investor holds. Behind an NDA is a count, never a name. Opening it is logged as opening the room. |
| `DiligenceFile.jsx` | `/research/diligence/:grantUid/files/:fileUid`. One document's facts and its download. A document behind an unsigned NDA has no name on the page. |
| `diligenceRead.js` | The size, date and file-state readings those two pages and their tests share. |
| `ClientPrepZone.jsx` | Advisor and partner client prep. |
| `FundsZone.jsx` | The founder shortlist at `/research/funds`. Stage, path and status stay three columns. |
| `FundDossier.jsx` | `/research/funds/:uid`. One row. A blank cheque stays blank. The pre-meeting brief is drafted from this row on the press, and Accept appends it to the note; it does not email the fund. |
| `fundDossierRead.js` | The dossier's checklist and Last-updated readings. A fact no store holds is Not recorded, never a gap. |
| `CompanyCandidate.jsx` | `/research/companies/:analysisId/:candidateId`. One competitor. A blank relevance stays blank. The draft restates the summary and the source titles. |
| `companyCandidateRead.js` | The readings that page and its tests share. |

The workspace chrome — crumb, zone pills, company chip — lives in
`frontend/src/workspaces/WorkspaceShell.jsx`, not in these files. A fit score
is not a field on this page.
