# pages/calendarScope — the Calendar's admin scopes (D4154, #4154)

The Mine · Studio · Platform switcher and the read-only staff views of
`/calendar`, from the owner's canvas (`design/incoming/Calendar Admin Page.dc.html`,
boards CA1–CA5).

| File | What it is |
| --- | --- |
| `calendarScopeModel.js` | The scopes' words and rules, pure: who sees which scope (`scopesFor`, mirroring `routes/calendar.ts`), `?scope=` in the address, a scoped item as a row, the type filter, the agenda by day and the month counts, and the coverage line. `BUILD.C1` (#4196) is what the items do not carry yet. Tested by `frontend/test/calendar_scope_d4154.test.mjs`. |
| `CalendarScopeView.jsx` | The switcher (`ScopeSwitch`) and the Studio and Platform views over `GET /api/calendar/events?scope=studio|all`, with the read-only item detail. `CalendarPage.jsx` renders it for `?scope=`. |

## Rules

- **Read-only.** No New, RSVP, reschedule, cancel or push is drawn in a staff
  scope; the route sends every item `read_only` with `can` all false.
- **The Worker decides access.** The switcher mirrors it; every read is
  re-checked (admin for Studio, the Super Admin on HQ for Platform).
- **"Not recorded" is never 0, and people are never shown by email.**
