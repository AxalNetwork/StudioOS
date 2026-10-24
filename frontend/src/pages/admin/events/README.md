# Events desk

D915 (#2368): the admin Events desk at `/admin/events`, built to the owner's
"Events Console" canvas (EV1–EV17, `design/incoming/Events Console Page.dc.html`).
`../AdminEventsPage.jsx` is the routed page at `/admin/events` (Overview),
`/admin/events/review` (Review), `/admin/events/all` (All events),
`/admin/events/calendar` (Calendar, D919) and `/admin/events/:id` (one event), in `AdminBoardFrame` workspace "Events". It
draws the shell: the crumb "Community › Events", the header, the literal tab
strip, then the tab the address names.

- `EventsOverview.jsx` — D920 Overview (EV1/2, EV12–15, EV17a): period radios,
  eight tiles, weekly chart/table, attention and upcoming rows, types, show-up,
  profiles/sources and status counts, with independent block states.
- `overviewModel.js` — D920's pure overview block states and derivations over
  D918: money by currency, period comparison, chart rows, profiles and links.
- `EventsReview.jsx` — Review (EV3): the queue, the selected event's facts,
  "What approving does" and the action bar; Approve (EV4) and Send back (EV5).
- `EventsAll.jsx` — All events (EV6, EV17d): the table, searched by title, with
  D919's filters, views, sorts, 25, 50 or 100 rows a page, the CSV of the rows
  on screen and the phone cards; each title opens the event's page.
- `EventsCalendar.jsx` — Calendar (EV8, EV8w, EV17e, D919): Month (Monday to
  Sunday, three chips a day, "+n more"), Week (a time grid, overlaps side by
  side) and List (the phone's default); the chip card; the address keeps the
  month, the view and the filters.
- `EventFilters.jsx` — the filters All events and the Calendar share.
- `EventPage.jsx` — one event (EV7): header, publish gate, tiles, agenda,
  the roster line, history, the actions and "More actions", a disclosure of
  links (not an ARIA menu).
- `EventDialogs.jsx` — the dialogs (EV4, EV5, EV9–EV11), each a `Lightbox`.
- `parts.jsx` — the card, pills, tile, refusal line and confirmation line the
  tabs share.
- `useEventsDesk.js` — the reads, each made alone. R2 and the queue are read
  again whenever the list is switched on or off, so they are read together;
  "Updated" is the oldest answer among the reads the tab draws.
- `eventsDeskModel.js` — pure. The tabs, the status words, Guard G, the
  derivations (ended, fill, show-up, the tiles), money, the publish gate, the
  facts, the dialogs' words and the refusal sentences.
- `calendarModel.js` — pure (D919). Where an event sits (its day and time
  where it happens), D915 §2's clash rule, the month, week and list layouts,
  the chips and the address.
- `allEventsModel.js` — pure (D919). All events' filters, views, sorts, page
  sizes, Needs attention's reasons and the CSV.

## Rules

- The desk reads `GET /api/admin/events` (every page, at `limit=200`),
  `GET /api/admin/events/analytics` (its per-event rows only, under Guard G),
  `GET /api/admin/events/:id` and `GET /api/events/:id/agenda`. It never reads
  the roster (names and emails), the analytics `summary`, or `conversion`.
- A read that failed says what could not be read; it is never drawn as zero.
  A value no store holds says "Not recorded", one stored but not summed yet
  "Not read here yet", an event that has not ended "Not held yet", and an
  event missing from the analytics read "Not in this read".
- Every dialog says only what the Worker does, and none is a browser pop-up.
- The Worker checks no status on a write, so after one the event just decided
  leaves the queue, and the event page's actions wait, until a read newer
  than the write lands. Focus then sits on the confirmation line.
- D920's Overview reads `GET /api/admin/events/overview?weeks=4|12|52`;
  its Next-up card reads the enriched list, with no capped analytics read.
  Charts reuse `../../../ui/Charts.jsx` and its one palette. Other tabs retain their
  own reads. Part 3's list (D918) gives the host line, host search
  and the Host filter; "Cancelled with paid tickets" reads D918's overview,
  only while that view is on (`useEventsDesk`'s `paidView`).
- Two events clash when neither is cancelled and their times overlap; an
  event with no `ends_at` lasts one hour (D915 §2). The Calendar and Needs
  attention use the one rule, `calendarModel.clashMap`.
