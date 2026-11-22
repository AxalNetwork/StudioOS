# Portfolio v2 frame and shared patterns

D4817 part 1 (#5311, canvas PF-01): the investor's Portfolio v2, drawn to
`design/incoming/Portfolio v2 Page.dc.html` and its boards. PF-01 (the
Overview, `../investor/InvestorPortfolioCanvas.jsx` at `/portfolio` and
`/portfolio/health`) is the first board built in this frame; PF-02 to PF-08
draw in the same frame with the same parts. Decision notes:
`documentation/architecture/decisions/D4817-p1.md`.

- `PortfolioFrame.jsx` — the one frame: skip link, the content as a named
  section (the app owns the one `<main>`), the crumb, the heading, the basis
  context, the local navigation (Overview · Positions · Reports · Performance
  · Value-add, the shell's `ZoneNav` with Performance added through
  `row.extra`), the route-aware document title (`portfolioTitle`) and the
  rail slot. A board passes its own `WorkerRail` as `rail`.
- `PortfolioParts.jsx` — the patterns built once (canvas PF-11): the financial
  metric (`FinancialMetric`, `MetricValue`), the basis strip, health status,
  the reporting obligation, a source that could not be read, a summary tile,
  and the attention item.
- `portfolioModel.js` — the pure model: a read's three states (`readOf`,
  `SHAPES`), the formatters, performance with its basis (`performanceOf`),
  health and reporting per company, the evidence rules and the Needs
  attention queue, the company table and its filters.
- `usePortfolioReads.js` — each source read, committed and retried on its own.
- `portfolio.css` — the frame's tokens (redefined under `.dark`) and its
  tablet (1100px, 850px) and phone (600px) layouts.

D4817 part 2 (canvas PF-02) draws Positions
(`../investor/InvestorPortfolioPositions.jsx` at `/portfolio/positions`) in
the same frame (`tab="positions"`). It adds to the model, not a second one: a
position's mark kind (`markOf`: marked, none, unusable), one basis vocabulary
(`basisLabel`), the date mark age is measured at (`markReference`: the positions
read's own `today` since D6226, never the browser clock), the register's rows, counts and total, one company's mark
history, and the attention rules with their evidence (`attentionRulesOf`).
Decision notes: `documentation/architecture/decisions/D4817-p2.md`.

D4817 part 3 (canvas PF-03) draws Performance
(`../investor/InvestorPortfolioPerformance.jsx` at `/portfolio/performance`)
in the same frame (`tab="performance"`). NAV at each quarter-end is one series
(`quarterSeriesOf`), read once per quarter-end with
`/api/positions/analytics?as_of=`, and drawn twice from that one list:
`QuarterEndChart.jsx` holds the plot with its labelled columns and the table,
and `QuarterEndBars.jsx` holds the recharts bars, loaded lazily. A quarter-end
with no book is a Not recorded gap and a failed one an Unreadable gap with its
own Retry; neither is a bar or a zero. The Overview's summary moved here as
`PerformanceSummary`, and `Skeleton` is shared. Decision notes:
`documentation/architecture/decisions/D4817-p3.md`.

D4817 part 4 (canvas PF-04) draws Reports
(`../investor/InvestorPortfolioUpdates.jsx` at `/portfolio/updates`) in the
same frame (`tab="updates"`). The obligations inbox is one row per company in
the reporting population (`obligationRowsOf`): its period, a Due cell with
the Worker's due day or "Overdue by N days" (`dueOf`, D6204; Not recorded
with the reason, `NO_DUE_DATE`, when the read gives none), the last update received, the shared `ObligationStatus`, what is
missing against the required KPI set (`missingFor`, measured only against an
update for the period, `periodCovers`) and the last chase (`lastChaseOf`). The
report detail opens in the shared Sheet with each field's source and date
(`reportFieldsOf`). The company Reports' Ask and Waive are not on this board.
Decision notes: `documentation/architecture/decisions/D4817-p4.md`.

## Rules

- A failed read reads **Unreadable** with a Retry for that source alone; a
  read that answered with nothing reads **Not recorded** with its reason; a
  measured zero stays 0. Never a zero or an empty book for a failure.
- No issue number, decision id or build-phase name in member copy (#5365 F-09).
- The rail's structure is #5130's; the Account-menu move is #4473's. The frame
  places the rail and links Portfolio's own routes, and changes neither.

D4817 part 8 (canvas PF-08) draws the Admin Investor preview: an
administrator who picked Investor in Preview shell reaches each Portfolio
board (`/portfolio`, `/portfolio/health`, positions, updates, performance,
value-add) as `PortfolioPreview.jsx`, which `PortfolioWorkspace` draws in
place of the investor board. It reads no investor record: the frame,
navigation and the real boards' section headings, each withheld figure and
section marked "Private in preview" (`PrivateChip`), and the real board's
writes drawn off with their reason. `PreviewBanner.jsx` is the one banner, in
the frame's `banner` slot; the shell's Preview shell strip stands down on those
addresses (`pageOwnsPreviewBanner`). `previewModel.js` holds the words and
rules, `preview.css` the look. Decision notes:
`documentation/architecture/decisions/D4817-p8.md`.
D4817 part 5 (canvas PF-05) draws Value-add
(`../investor/InvestorPortfolioValueAdd.jsx` at `/portfolio/value-add`) in the
same frame (`tab="value-add"`). `valueAddModel.js` is its pure model over the
support ledger (`/api/portfolio-support`): the six figures (`figuresOf`), the
commitments with owner, state and dates (`commitmentOf`), the introductions
(`introductionsOf`, counted only over a read that holds every entry), hours
(`hoursLabel`, `hoursOf`) and the per-company rollup. In progress, Cancelled,
a due date and the meetings that came of an introduction are not recorded by
the ledger and read Not recorded with that reason; failed figures (`totals:
null`) read Unreadable beside the entries that were read. `valueAdd.css` holds
its figure row, tables, in-place confirmation and Log support form. Decision
notes: `documentation/architecture/decisions/D4817-p5.md`.
D4817 part 7 (canvas PF-07) takes the two money writes, a valuation mark and
a distribution recorded by an admin against one company's position, Prepare →
Review → Confirm → Receipt. The writes stay where they were, in the admin
position sheet (`../PortfolioPositionsPage.jsx`, Cap Table), on the same
routes (`POST /api/positions/:projectUid/marks`, `/distributions`), which now
audit each act. `WriteFlow.jsx` draws the four steps with the company named in
each; `writeFlowModel.js` holds the pure parts (fields and their errors, the
payload, what will be written and its effect before → after, the conflict
check, the receipt from the stored row); `writeFlow.css` holds its tokens,
redefined under `.dark`, and its phone layout. Before saving, the company is
read again; if the history the write lands in moved, nothing is sent and the
draft is kept. Decision notes:
`documentation/architecture/decisions/D4817-p7.md`.
D4817 part 6 (canvas PF-06) draws one company's workspace
(`../investor/PortfolioCompanyPage.jsx` at `/portfolio/companies/:uid`, with
`/financials`, `/reports`, `/support` and `/activity`; the old `/terms` lands
on Financials' Ownership & rights) in the same frame, through its optional
`title`, `crumb`, `nav` and `docTitle`. Its pure model is `companyModel.js`
(tabs and titles, who the company is to the caller, the holding route, the
six key facts, evidence and next actions, rounds, return, support and the
joined activity timeline); `CompanyPanels.jsx` draws Financials, Support and
Activity; `company.css` holds their styles on the frame's tokens. The name is
drawn only once an authorised read has named the company. Decision notes:
`documentation/architecture/decisions/D4817-p6.md`.

D6208 (#6208) adds the Overview table's Sector, Stage and Reporting filters
and its sort (`filterRows`, `filterOptionsOf`, `sortRows`, `tableCaptionOf`
in the model) and the header's Export on the Overview and on Performance.
`PortfolioExport.jsx` draws Export, one button or a menu of choices, and
writes only through `exportView` (`../../lib/csvExport.js`); the model's
`companyExportOf`, `quarterExportOf` and `cohortExportOf` decide what each
file holds, or why there is nothing to write. Decision notes:
`documentation/architecture/decisions/D6208.md`.
D6227 (#6227) turns Activity into one timeline: the Worker's joined read
`GET /api/positions/:uid/activity` (client `../../lib/api/positionActivity.js`),
drawn by `CompanyActivity` through `companyModel.js`' `activityOf`. A source
the Worker reports as failed is named with its own Retry, never read as no
activity. Decision notes: `documentation/architecture/decisions/D6227.md`.
D6222 (#6222) adds the investor's private notes to the company Overview:
`CompanyNotes.jsx` holds the read and its writes (`useCompanyNotes`, client
`../../lib/api/portfolioNotes.js`, Worker `/api/portfolio-notes`) and
draws the Notes card (add, edit, delete, each note with its dates), where
What changed's "Save as my note" lands. A failed read is Unreadable with a
Retry, never "no notes"; a failed save keeps the text with the sentence for
the refusal's code (`NOTE_SENTENCES`). Decision notes:
`documentation/architecture/decisions/D6222.md`.
D4817 part 9 (addendum PFA03–PFA05, PFA10) rebuilds the company Reports'
"Ask for this report" and "Waive this period". `reportAsk.js` holds the pure
rules (the most pressing open period, its obligation facts, who may act from
the Worker's `can_act`, the Review, the confirm label, the Receipt from the
Worker's stored record, and each period's asked or waived record);
`ReportAsk.jsx` draws the obligation card and the Review and Receipt Sheet;
`reportAsk.css` holds their styles on the frame's tokens. A failed send keeps
the Review with the Worker's sentence and code, and a period reads as asked or
waived only from the company read. Decision notes:
`documentation/architecture/decisions/D4817-p9.md`.

D4817 part 10 extends the Admin Investor preview to the company workspace:
on `/portfolio/companies/:uid` and its tabs, `PortfolioCompanyPage` draws
`CompanyPreview.jsx` when `isInvestorPreview` holds. It reads nothing, says
"Company withheld in preview" in place of the name, carries the chip on the
six key facts and each tab's sections (`previewModel.js`' `PREVIEW_COMPANY_FACTS`
and `PREVIEW_COMPANY_TABS`), and draws each tab's writes off with their reason
through `PortfolioPreview.jsx`' `OffWrites`. `previewCompanyTabOf` names the
company addresses, so `pageOwnsPreviewBanner` (and App.jsx's
`PREVIEW_BANNER_COMPANY`) stand the shell's strip down there too. Decision
notes: `documentation/architecture/decisions/D4817-p10.md`.

D6867 (#6867, canvas D6217 PF-13) adds the shareable statement: a
Statement action on Overview and Performance opens `StatementSheet.jsx` (the
sheet: the quarter-end chooser, the preview strip, the mismatch note, the
cover note, Download PDF and the downloaded confirmation; `statement.css`
holds its styles on the frame's tokens). `statementModel.js` is its pure half
(`statementDatesOf`, `previewOf`, `mismatchOf`, `fundedAfter`,
`summaryRowsOf`, `positionRowsOf`, `statementOf`) and owns `METHODOLOGY`,
which Performance draws and page 5 prints word for word. The PDF is
`../../lib/portfolioStatementPdf.js`. Decision notes:
`documentation/architecture/decisions/D6867.md`.
D6888 (#6888, canvas D6217 PF-13a and PF-13h) adds Eadwyn's covering-note
proposal for the statement: `StatementCoverNote.jsx` is the card (Copy, Edit,
Discard, and "Eadwyn is unavailable. The statement does not need it." when
Eadwyn is off), and `coverNoteModel.js` holds its words and what each answer
reads as. It drafts on the press from the statement's own figures for the date
and keeps nothing. The Statement sheet mounts it in its rail for the chosen
date, and Edit ticks "Include as a cover note" with the proposal in that box.
Decision notes: `documentation/architecture/decisions/D6888.md` and
`documentation/architecture/decisions/D6888-p1.md`.
D6907 part 2 (#6907, canvas PRM18 rail) adds Eadwyn's proposal of a right that
is in the investor's signed paper but not recorded, on Ownership & rights:
`ClauseProposals.jsx` is the card (Accept, Edit wording, Discard), and
`clauseProposalModel.js` is its pure half (`proposalsOf`, `clauseLocation`,
`unreadableDocs`, `railState`). It reads the clause read (D6907 part 1) only for
the types `askableTypes` gives: not recorded, and no open request. Accept sends
exactly one request to record the right, with the clause as its description,
and Eadwyn never records one. A document it could not read is listed with its
reason. Decision notes: `documentation/architecture/decisions/D6907.md` and
`documentation/architecture/decisions/D6907-p2.md`.
