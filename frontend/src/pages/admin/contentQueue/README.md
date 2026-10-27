# Content queue tabs

D1297 (#3393, part 7 of #2383): the Content queue's Authors and Performance
tabs, built to the owner's canvas (ART9–ART12, the phone in ART18,
`design/incoming/Content Queue Page.dc.html`). `../ArticlesQueuePage.jsx` is
the routed page and mounts them at `/admin/articles/authors` and
`/admin/articles/performance`; the addresses are `../contentQueueModel.js`'s.

- `statsModel.js` — pure. Each author's row, the tiles, search, filters, sort
  and pages; the periods and the range each asks for; the performance read as
  the page draws it. A figure a read does not carry is "Not recorded", never 0.
- `AuthorsTab.jsx` — Authors (ART9) with the author drawer (ART10), from
  D1294's `GET /api/admin/articles/authors`. A table from `md` up, cards and a
  bottom sheet for the filters below it.
- `PerformanceTab.jsx` — Performance (ART11, ART12), from D1294's
  `GET /api/admin/articles/performance`: the period, the tiles, the weekly
  charts each with View as table, views by sector, the top articles and what
  is not recorded yet.

Rule for adding here: a tab of the Content queue that is its own slot task
goes in this folder, takes its read as a `load` prop so a test can answer it,
and keeps its rules in a pure model that a test in `frontend/test/` holds.
