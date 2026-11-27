### Distribution Calendar (D4489, #4489; part of #3722)

`/grow/distribution/calendar` mounts `CalendarTab.jsx` inside #4484's shell: a
month/week grid (`calendarModel.js`) over the existing content-piece store,
with `PieceSheet.jsx` for plan details and time edits and `PostPreview.jsx`
for unscaled platform frames. Plans only; publishing still uses the existing
`PublishSheet`, and Notion-sourced pieces are edited in Notion. Overview's
"This week" summary reads the same inclusive Monday–Sunday window.

| Route | Purpose |
| --- | --- |
| `GET /api/grow/calendar?project=&from=&to=&...` | Scoped content pieces for the visible range (`grow_calendar.ts`) |
| `PUT /api/grow/calendar/pieces/:uid/time?project=` | Change a piece's planned time only; venture writers |

Client: `frontend/src/lib/api/growCalendar.js` (`growCalendar.pieces`,
`growCalendar.time`). No send, schedule-to-platform or new piece store.
