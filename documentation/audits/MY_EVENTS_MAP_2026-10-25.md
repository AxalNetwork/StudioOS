# My events — the canvas against the code, 2026-10-25

S21's map for D1030 (#2387). The owner's "My events" canvas, MEV1–MEV18 with lettered boards (`design/incoming/My Events Page.dc.html`, `My Events · Boards.dc.html`), read board by board against `origin/main` at `154cd86cf5`. True as of that date; re-check the code before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2387 called broken, re-checked

| # | #2387's finding | Today | Where |
|---|---|---|---|
| 1 | The ticket pill shows the event's status | **Fixed** (#2626): the pill reads `reg_status` | `fe/pages/events/MyEventsPage.jsx` |
| 2 | The QR never shows | **Fixed**: `GET /api/events` returns `checkin_code` for a confirmed, paid seat | `wk/routes/events.ts` ~185-201 |
| 3 | "Free seat" never shows | **Fixed**: `comp` is sent | same |
| 4 | Edit opens an empty form | **Fixed** (#2626, D916): the editor reads `reply.event` | `fe/pages/events/EventEditorPage.jsx` ~82 |
| 5 | Private and unlisted events cannot be published | **Half**: `submit-review` publishes a non-public event (`events.ts` ~516-524); the editor still offers the button only for public events | `EventEditorPage.jsx` |
| 6 | A host cannot cancel | **Open**: only the desk cancels | `wk/routes/admin_events.ts` |
| 7 | A sent-back event has no badge | **Open** on the old page; D1030 draws "Sent back" for `rejected` | `MyEventsPage.jsx` |
| 8 | Notices land on "Event not found" | **Open**: live, sent back, cancelled and reminder notices link `/events/<slug>` | `admin_events.ts` ~288, ~334, ~361, ~421, ~472; `wk/services/eventReminders.ts` ~96 |
| 9 | The member `.ics` is broken | **Fixed** (#2626) | `fe/lib/eventsApi.js` `icsUrl` |
| 10 | The join link is public | **Fixed** (#2623): only seat holders and managers | `wk/services/eventsCommon.ts` ~78 |
| 11 | Advisors cannot be an audience | **Open** | `wk/services/eventOrganiser.ts` ~5 `EVENT_ROLES` |

## 2. The reads on `main`

| Read | Shape | Boards |
|---|---|---|
| `GET /api/events` | `hosting` (every hosted event, private fields); `attending` (registered, confirmed, attended, waitlisted) with `reg_status`, `reg_waitlist_position`, `comp`, `checkin_code` | MEV1, MEV2, MEV4, MEV9 |
| `GET /api/events/suggested` | up to eight upcoming events with `suggestion_reason` | MEV1, MEV8 |
| `GET /api/public/events?limit&offset&q&from&to&type&past` | `{ events }`, no total | MEV8 |
| `GET /api/events/:id/ics` | the calendar file | MEV1, MEV3 |

Not in any read: cancelled and declined places, `payment_status` on the list (the query selects it but does not return it), per-event seats, waitlist, approvals, check-ins and open invitations, the review note, pending invitations signed in, the calendar kinds, a replay link.

## 3. What `registered` means

`registered` is a seat held while the host approves (`events.ts` ~689, ~762), so it reads "Waiting for the host". `confirmed` is "Going"; the check-in code appears only once it is paid.

## 4. Board by board

| Board | Drawn by D1030 | Waits for |
|---|---|---|
| MEV1 Upcoming | the tabs with counts, Needs you (sent back), the next event with its code, .ics and Join, Going grouped by when, Hosting soon, Suggested | the month calendar, Subscribe, Pay to confirm, invitations, off the waitlist, Add to Google or Outlook (parts 2, 3, 5) |
| MEV2 Explorer | no Hosting tab, no New event, the line | "Not open to Explorers" on a suggestion (part 2) |
| MEV3 Ticket drawer | — | part 5 |
| MEV4 Hosting | groups by what each needs, search, the one action per status | counts per event, the ⋯ menu, filters, pages (parts 2, 5) |
| MEV5–MEV7 Drawer, publish, cancel | — | parts 2, 5 |
| MEV8 Discover | Suggested, search, upcoming public events with price and "Going" | type, month, format and price filters, "Free for me" (part 2) |
| MEV9 Past | places and hosted events with their result, Replay "Not recorded" | cancelled and declined places, the chart (parts 2, 4) |
| MEV10 dark, MEV11 month | — | part 4 |
| MEV12 host header | — | part 6 |
| MEV13 Admin | the review desk line | the waiting count (part 6) |
| MEV14–MEV17 states | empty, loading, a failed read never "none", a failed Discover read alone | part 4 |
| MEV18 phone | D700's A7m, unchanged | part 7 |
