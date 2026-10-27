# Content queue tabs

D1296 (#3392): the Content queue's tabs that are built apart from
`../ArticlesQueuePage.jsx`, which mounts them at the addresses named in
`../contentQueueModel.js` (D1290).

- `Calendar.jsx` — Calendar at `/admin/articles/calendar` (ART7, ART8,
  ART13c): month and week, Move… on every scheduled chip, the Ready to publish
  list with Schedule…, and the schedule dialog. It reads D1291's queue by date
  range and writes through D484's schedule call.
- `calendarModel.js` — its rules, which are pure: the grid, the reader's
  zone and UTC, the chips per day, the read range and what a time may be.

Add a tab here when its slot task builds it, and drop its entry from
`WAITS` in `../contentQueueModel.js` in the same change.
