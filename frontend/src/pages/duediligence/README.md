# Due diligence (D1244, #2385)

The tabs of the Due diligence desk under `/admin/due-diligence` and `/due-diligence`, from the owner's canvas "Due diligence" (DDL1–DDL19).

| File | What it is |
|---|---|
| `ddModel.js` | The two bases, the list's tabs and the case's nine tabs, `viewOf` for an address, the risk band's words with "Not scored yet", the decision's words, and the words of every block no read carries yet |
| `DdTabs.jsx` | The list's tabs (Cases, My reviews, Templates), the case's tabs, and the body of each tab that is not drawn yet |
| `ddListModel.js` | D1250: the list tabs' pure rules — the tiles and charts from the overview, the stage strip, the filters, each row's cells, Open a case's payload and the template editor |
| `DdCasesTab.jsx` | D1250: Cases (DDL1, DDL19) — tiles, charts, the stage strip, the toolbar, the columns, paging and each row's menu, with the states of DDL16 and DDL17 |
| `DdCharts.jsx` | D1250: the two stacked-column charts, "Not recorded" as a dashed hairline, with View as table |
| `DdListDialogs.jsx` | D1250: Open a case (DDL2, DDL2b) and the row menu's Change lead, Set target IC date and Archive |
| `DdTemplates.jsx` | D1250: Templates (DDL13) — the Super Admin's editor, read only for everyone else |
| `DdUi.jsx` | D1250: the classes, the in-page dialog, the note and the refusal the list tabs share |
| `ddReviewModel.js` | D1252: the reviewer's and the subject's rules, pure — My reviews' rows, the reviewer's banner and steps from a scoped case read, a request's due date and lateness, the answer's body and the data-room file choices |
| `DdMyReviews.jsx` | D1252: My reviews (DDL12a) from `GET /api/dd/my-reviews`, a table from `md` up and cards on a phone |
| `DdReviewer.jsx` | D1252: the reviewer's banner and steps on a case (DDL12b, DDL18c), with the NDA and conflicts dialogs; nothing for the deal team |
| `useDiligenceInvolvement.js` | D1252: whether a partner, investor or advisor leads or reviews any case, for the sidebar's "Diligence" row (`withDiligenceRow` in `../../sidebarConfig.js`) |

`../AdminDueDiligencePage.jsx` mounts the list tabs (and sends a founder to their requests), and `../AdminDueDiligenceCasePage.jsx` mounts the case tabs and the reviewer's panel. Overview is today's whole case page. `../DueDiligenceRequestsPage.jsx` is the subject's own page (DDL15): the requests addressed to them, never the case.

**Adding to it:** every tab is an address, never `?tab=`. A block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A link stays on the caller's base, so a member never reaches an `/admin/…` address.
