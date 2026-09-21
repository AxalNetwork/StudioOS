# frontend/src/pages/research — zone bodies

The bodies `ResearchWorkspace` mounts for a slug, plus the one page that is not
a zone: a single researched fund.

| File | What it is |
| --- | --- |
| `AskZone.jsx` | Ask, over documents the caller uploaded. |
| `LibraryZone.jsx` | Those documents. |
| `MarketZone.jsx` | Markets. |
| `BenchmarkingZone.jsx` | Investor benchmarking. |
| `DiligenceZone.jsx` | Investor diligence, assembled from room grants. |
| `ClientPrepZone.jsx` | Advisor and partner client prep. |
| `FundsZone.jsx` | The founder shortlist at `/research/funds`. Stage, path and status stay three columns. |
| `FundDossier.jsx` | `/research/funds/:uid`. One row. A blank cheque stays blank. The draft restates the page and does not email the fund. |
| `CompanyCandidate.jsx` | `/research/companies/:analysisId/:candidateId`. One competitor. A blank relevance stays blank. The draft restates the summary and the source titles. |
| `companyCandidateRead.js` | The readings that page and its tests share. |

The workspace chrome — crumb, zone pills, company chip — lives in
`frontend/src/workspaces/WorkspaceShell.jsx`, not in these files. A fit score
is not a field on this page.
