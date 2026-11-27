### My events in the calendar (D1033, #2874)

`routes/calendar.ts`, mounted at `/api/calendar`; the kinds are `services/calendar/myEvents.ts`.
- `GET /api/calendar/events` and `GET /api/calendar/events.ics` carry two more kinds: `event_ticket` (one per registration the member holds: registered, confirmed, attended or waitlisted, each marked in its title) and `event_hosted` (each event the member hosts, every status but cancelled). `.ics` now takes `kinds` as `/events` does, so `?kinds=event_ticket,event_hosted` is "my events" alone; an unknown kind or an unreadable `from`/`to` is 400.
- The join link (`location_url`) rides only on a copy whose reader may have it (#2623): an admin, the host, an in-person event, or a confirmed or checked-in seat with no payment pending.
- `POST /api/calendar/push/event_ticket/:registration_id` and `/push/event_hosted/:event_id` copy one to the member's connected calendars. Google and Outlook sync carries both kinds, with no attendees, and on each sync removes the copies whose place or event has left (`removed` in the summary).
- `GET /api/calendar/event-links/:event_id` (`requireAuth`, then `canViewEvent`'s rule as `eventVisibleTo`): `{ event_id, ics, google, outlook, office365, join_link_included }`. 404 for an unknown event, 403 for one the caller cannot see.
- "Subscribe to my events" (migration 603, `services/calendar/feedTokens.ts`):
  - `GET /api/calendar/my-events/feed` (`requireAuth`): `{ subscribed, created_at, last_used_at }`, never the URL.
  - `POST` on the same path (`requireAuth`) makes the member's token, replacing any older one: 201 `{ url, webcal_url, created_at, replaced, note }`, the URL shown once. Only the token's SHA-256 is stored.
  - `DELETE` on the same path (`requireAuth`) removes it: `{ revoked }`.
  - `GET /api/calendar/feed/my-events.ics?token=…` needs **no session**: the token names the member. It serves `event_ticket` and `event_hosted` alone (seven days back, 180 ahead), `private, no-store`. Every refusal is the same 404 (no token, a malformed or unknown one, an inactive account, a deletion request, or a "sign out everywhere" after the token was made). The token is in the query so the observability middleware, which records the pathname, never logs it. `INVESTOR_PRO_EXEMPT` lets this one GET past the session gate on `/api/calendar`, and the route gives an investor below Professional the same 402.

