### Events desk gaps (D1116, #2996)

`/admin/events/all` adds the Type and Format columns and filters
(`?type=`, `?format=online|in_person|hybrid`), and each row's ⋯ menu on the
table and the phone cards: Open, Feature or Stop featuring, Change capacity,
Unpublish, Cancel event and Open as host, through the event page's own dialogs
and writes (`admin_events.ts`). `/admin/events/calendar` adds the same two
filters and names the type and format on its chip card. `/admin/events/review`
adds the Agenda fact ("[n] items · [m] speakers", expandable) from
`events.ts` `GET /:id/agenda`. On a phone the desk's dialogs are bottom sheets.
No route, Worker change or migration is added.

