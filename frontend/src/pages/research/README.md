# frontend/src/pages/research — zone bodies

The bodies `ResearchWorkspace` mounts for a slug, plus the pages that are not
zones: one record each, reached from a zone's list.

| File | What it is |
| --- | --- |
| `ResearchOverviewPanel.jsx` | The `/research` overview (Research · Main canvas, D536/D546), read from `GET /api/research/overview`. Not a zone: mounted inside the founder desk, the investor workspace and above the advisor and partner board. Each section is ok, Not recorded or Unreadable on its own; a missing count is never 0. |
| `ResearchHome.jsx` | D3701 RS-01: the Overview cards under the founder desk's question. Continue where you left off (the newest Ask exchange), Recent research projects (the newest three, from the Research Project store, D5157), Saved briefs (Not recorded, because no store exists), Recently added evidence (the library with both states) and Tracking (the fund list). Each card reads, fails and retries on its own. |
| `researchHome.js` | The readings `ResearchHome.jsx` draws: loading, unreadable, not recorded or ok per card, the three examples, and dates that read Not recorded rather than today. |
| `MyResearch.jsx` | D5157: `/research/projects`, My Research. The caller's Research Projects as cards (Active / Archived), the New research form (`?new=1&question=` opens it, prefilled) and the "No research yet" empty state. An unreadable list says so with Retry, never as empty; Restore runs on press. |
| `ResearchProject.jsx` | D5157: `/research/projects/:uid` (Overview) and `/:uid/evidence` (Evidence), RS-02 A and B. Objective, scope and exclusions with Edit; progress as a stored fraction; the project's Ask history; the evidence table with index state and In Ask apart; Add evidence from the Library; Archive through Scope → Review → Result. Findings, Comparisons and Brief are not stored yet and say so. |
| `researchProjects.js` | The readings those two pages and RS-01's Recent research projects share: status words, counts where zero is a recorded zero and a missing count is Not recorded, evidence rows and origin, the form's checks and body, and the archive scope. |
| `researchStates.js` | D3701 (Research v2): the words, tones and glyphs for a document's index state, whether Ask may cite it (read only from the Worker's `in_ask`), a Failed or Unsupported row's reason and next step, and Ask's seven response states. Unknown is Not recorded. |
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
| `FundDirectory.jsx` | The fund directory, to `Research · Funds` (D535): server search, filters, sort and paging over `GET /api/research/fund-directory`; coverage, the drawer (the shared right-side `Sheet`, D1317; a bottom sheet on a phone), and the four states. A size shows only in a known currency; stage reads Not recorded. Every row and the drawer cite the fund's list, publisher and terms verdict, and the footer names any list removed for its terms (D597). |
| `fundDirectoryRead.js` | That page's readings: "1–25 of N", the page list, a size only in a known currency, EIF/EIFO named, neither or unknown, and `citationOf` (D597): a fund's list, publisher, link and terms verdict. |
| `FundCatalogProfile.jsx` | `/research/funds/catalog/:id`. One directory fund, inside `WorkspaceShell`. A failed read is Unreadable, a missing id says so, and a fund whose list was removed for its terms (410, D597) says that and why. |
| `FundDossier.jsx` | `/research/funds/:uid`. One row. A blank cheque stays blank. The pre-meeting brief is drafted from this row on the press, and Accept appends it to the note; it does not email the fund. |
| `fundDossierRead.js` | The dossier's checklist and Last-updated readings. A fact no store holds is Not recorded, never a gap. |
| `CompanyAnalysis.jsx` | `/research/companies/:id`. One saved analysis. A save sends the title and the output, never the candidate set. The landscape read restates the page and Accept appends it to the notes. |
| `companyAnalysisRead.js` | That page's tiles, inputs row, feature grid and landscape read, in three shapes for a failed read, a failed run and a finished one. |
| `CompanyCandidate.jsx` | `/research/companies/:analysisId/:candidateId`. One competitor. A blank relevance stays blank. The draft restates the summary and the source titles. Back-links to its analysis. |
| `companyCandidateRead.js` | The readings that page and its tests share. |
| `CompanyDirectoryZone.jsx` | `/research/companies`. The company directory, searched, filtered, sorted and paged on the Worker (D534); it prints the API's total, coverage and facet counts, never a count of its own. A Saved analyses tab holds the competitor analyses and is where `/build/competitors` lands. |
| `CompanyProfile.jsx` | `/research/companies/company/:uid`. One directory company: metrics with source and date or Not recorded, market context, same-label competitors, funds by focus and HQ, signals, and the sources table. Each read fails on its own. |
| `ProjectFindings.jsx` | D5157 part 2: a Research Project's Findings tab (`/research/projects/:uid/findings`, RS-02 C) and the Overview's Most recent findings. Source fact, Eadwyn interpretation and Your conclusion as words; Accept / Edit / Discard on Eadwyn's words from the project's Ask answers; the citation panel with the recorded passage, a bottom sheet on a phone. An unreadable read is Unavailable, never empty. |
| `researchFindings.js` | The readings that tab and card share: kind and state words, chip counts with discarded kept apart, the badge (absent, never 0, on a failed read), the citation panel's lines and the forms' checks and bodies. |
| `ProjectComparisons.jsx` | D5157 part 3: a Research Project's Comparisons tab (`/research/projects/:uid/comparisons`, RS-02 D). The project's companies and funds with Compare and Remove, and each comparison as a table with row headers, each value with its source and date, Not recorded with the reason and Unreadable apart; cards on a phone. An unreadable read is Unavailable, never empty. |
| `researchComparisons.js` | The readings that tab and the Add to research panel share: cells, columns that left the directory, the badge (absent, never 0, on a failed read), refusal words and which shells may add to research. |
| `AddToResearch.jsx` | D5157 part 3: the Add to research and Compare panel (RS-04, RS-05), the shared `Sheet`: pick one of your active projects or start one, then keep the companies or funds there or open a comparison of them. |
| `ResearchActions.jsx` | D5157 part 3: a company or fund profile's Add to research and Compare buttons, which open that panel. |

The workspace chrome — crumb, zone pills, company chip — lives in
`frontend/src/workspaces/WorkspaceShell.jsx`, not in these files. A fit score
is not a field on this page.
