# Content queue tabs

`../ArticlesQueuePage.jsx` holds the header and the four tabs (D1290) and
mounts this folder at the addresses named in `../contentQueueModel.js`.

D1295 (#3391): Pipeline of HQ › Content › Content queue (`/admin/articles`),
as the owner's canvas draws it (ART1–ART6, ART13–ART17).

| File | What it is |
|---|---|
| `pipelineModel.js` | Pure rules: the seven stages, each article's wait, the counts, the list's state in the address, the actions each viewer is offered, every dialog's words, paragraph anchors, threads and the line compare |
| `Pipeline.jsx` | The board by stage (ART1) and the list with search, filters, sort, totals and paging (ART2), the count strip, and the empty, loading and failed states (ART13–ART15) |
| `ReviewDrawer.jsx` | One article's review at `/admin/articles/<id>`: Article, Comments, Revisions and Details (ART3–ART5), and the footer's actions |
| `QueueDialog.jsx` | The one in-page dialog every change opens (ART6) |
| `NoPermission.jsx` | What a member who is not an admin sees on a Content queue address (ART17b), drawn by App.jsx's `ROUTE_BOUNDARIES` |

**Adding to Pipeline:** every read and change is `adminArticles` in `../../../lib/api.js` (D1291–D1293). A change opens `QueueDialog`, never a browser pop-up, and says what it changes; a reason the author reads is at least 8 characters. A count or a figure that was not read says so, never 0. The Worker decides who may act; `actionsFor` only decides what is offered.

D1296 (#3392): Calendar at `/admin/articles/calendar`.

- `Calendar.jsx` — Calendar (ART7, ART8, ART13c): month and week, Move… on
  every scheduled chip, the Ready to publish list with Schedule…, and the
  schedule dialog. It reads D1291's queue by date range and writes through
  D484's schedule call.
- `calendarModel.js` — its rules, which are pure: the grid, the reader's
  zone and UTC, the chips per day, the read range and what a time may be.

D1297 (#3393, part 7 of #2383): Authors and Performance, built to the owner's
canvas (ART9–ART12, the phone in ART18,
`design/incoming/Content Queue Page.dc.html`), at `/admin/articles/authors`
and `/admin/articles/performance`.

- `statsModel.js` — pure. Each author's row, the tiles, search, filters, sort
  and pages; the periods and the range each asks for; the performance read as
  the page draws it. A figure a read does not carry is "Not recorded", never 0.
- `AuthorsTab.jsx` — Authors (ART9) with the author drawer (ART10, the shared Sheet, D1317), from
  D1294's `GET /api/admin/articles/authors`. A table from `md` up, cards and a
  bottom sheet for the filters below it.
- `PerformanceTab.jsx` — Performance (ART11, ART12), from D1294's
  `GET /api/admin/articles/performance`: the period, the tiles, the weekly
  charts each with View as table, views by sector, the top articles and what
  is not recorded yet.

A tab of the Content queue that is its own slot task goes in this folder,
takes its read as a `load` prop so a test can answer it, and keeps its rules
in a pure model that a test in `frontend/test/` holds. Drop its entry from
`WAITS` in `../contentQueueModel.js` in the same change.
