# Calendar map — 2026-10-25

The owner's "Calendar" canvas (#2420, boards CAL1–CAL21), read against the code on `origin/main` at `2f5d53e260`. This snapshot is true as of that date and is **not maintained**. The decision that acts on it is D1205.

## 1. The canvas

`design/incoming/Calendar · Boards.dc.html` holds the board grid, which imports `Calendar Page.dc.html`. It replaces `design/canvases/integrated/Calendar.dc.html` (C1–C6, D305) as the page's target.

| Boards | What they draw |
|---|---|
| CAL1, CAL13, CAL14 | Month for a Founder, an Admin with the Mine · Studio scope, an Explorer |
| CAL2, CAL20 | Week for an Investor, light and dark: a time grid, an all-day row, overlapping blocks |
| CAL3 | Agenda for an Advisor |
| CAL4, CAL5 | The item drawer: an IC meeting, and the other kinds' drawers |
| CAL6 | The Kinds filter: five families, quick sets, a dash for a source that did not answer |
| CAL7, CAL8, CAL19 | New IC meeting, the New menu and New check-in, Reschedule and Cancel |
| CAL9–CAL11 | Connected calendars, the Google connection, Subscribe |
| CAL12 | The day popover and quick look |
| CAL15–CAL18 | Empty, loading, error and partial, no permission |
| CAL21 | Phone |

## 2. #2420's broken items, re-checked

| # | Finding | On `main` today |
|---|---|---|
| 1 | An admin's sync and `.ics` carry every member's meetings | **Fixed by #2637:** the readers are owner-only, an admin's personal calendar included |
| 2 | Free-plan investors are locked out | **Open:** `/api/calendar` is still in `INVESTOR_PRO_PREFIXES`; only the my-events feed is exempt (D1033) |
| 3 | "Subscribe" is a one-off download | **Partly fixed by D1033:** a token feed for tickets and hosted events (migration 603); the whole calendar has none |
| 4 | A failed source's chips read 0 | **Fixed by D1205:** the chip shows a dash with its reason |
| 5 | Cancelled meetings vanish | **Open:** IC meetings and check-ins still drop `cancelled` |
| 6 | A pending booking looks confirmed | **Open** |
| 7 | Disconnect deletes the push records | **Open** (`DELETE FROM calendar_sync_records` on both providers) |
| 8 | Two Google disconnects differ | **Open** |
| 9 | The consent asks for Gmail | **Fixed by #2627** (#2413 closed) |
| 10 | Sync copies Calendly bookings | **Not re-checked here;** part 1 confirms and fixes |
| 11 | An advisor with no `users.advisor_id` sees no sessions | **Open:** the reader still finds the advisor only by that column |
| 12 | Anyone can book a check-in with any founder | **Fixed by #2637:** meeting relationships are validated |
| 13 | A sync failure is not kept | **Open:** no `last_sync_error` |
| 14 | Copy no longer true | **Partly fixed by D1205:** the legend counts its kinds instead of "Six sources, six kinds"; the connected-card copy is open |
| 15 | Raw error text in `sources[].error` | **Open** |
| 16 | A stale comment | **Open** |

## 3. What each board can read today

| Board | Read | Drawn by D1205 |
|---|---|---|
| CAL1–CAL3 | `GET /api/calendar/events?from&to` for eight kinds, with `sources` | The three views at their own addresses, each asking for its window (Month, Monday-to-Sunday week, 90-day agenda); the one list grouped by day, as before |
| CAL6 | the same `sources` | Each kind's chip, a dash with its reason when its source did not answer |
| Deadlines family; interview calls | none | Not read here yet |
| CAL11 | the my-events token feed (D1033) | Not read here yet for the whole calendar |
| CAL4, CAL5, CAL7–CAL10, CAL12–CAL21 | the existing create, RSVP, cancel, push, Google and Outlook routes | As today: inline on the row and in the rail |

## 4. What waits, and on what

- **Worker parts** (1–4) start now. Only part 4 needs a migration: **610**, for the sync error columns and the whole-calendar feed.
- **Frontend parts** (5–7) follow them.
- **Owner questions 2, 3, 4, 6, 7 and 8** take #2420's proposal (a) until the owner answers otherwise.
