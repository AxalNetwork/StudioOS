### Calendar part 4: the whole-calendar feed, the sync error state, disconnect (D1209, #3175)

`routes/calendar.ts`; migration 610; `services/calendar/feedTokens.ts`, `syncState.ts` and `sync.ts`.
- "Subscribe to my whole calendar", on a token of its own (scope `calendar`):
  - `GET /api/calendar/subscription` (`requireAuth`): `{ subscribed, created_at, last_used_at }`, never the URL.
  - `POST` on the same path makes the token, or replaces it (`replaced: true`), and the old URL stops at once: 201 `{ url, webcal_url, created_at, replaced, note }`, shown once.
  - `DELETE` on the same path removes it: `{ revoked }`.
  - `GET /api/calendar/feed/calendar.ics?token=…` needs **no session**. It serves every kind the member's own calendar reads ("Mine": no reader widens for a role), from 30 days back to 180 ahead, with `private, no-store`. A my-events token is refused here, and this token by the my-events feed. The refusals and the plan rule are those of `/feed/my-events.ics`, and `INVESTOR_PRO_EXEMPT` names this path too.
- `GET /api/calendar/google/status` and `/microsoft/status` add `sync_error` and `sync_error_read`:
  - `sync_error` is `{ code, message, at }`, where `code` is `connection_refused`, `copy_refused` or `sync_failed`. It is null when the last sync completed.
  - `sync_error_read` is false when the state could not be read.
  - Each sync writes the state, and so do the create and cancel hooks. A sync that completes clears it.
- Disconnect:
  - `DELETE /api/calendar/google` and `POST /api/calendar/google/disconnect` are one handler. So are `DELETE /api/calendar/microsoft` and `POST /api/calendar/microsoft/disconnect`.
  - Each keeps the copies and their `calendar_sync_records` (`{ ok, copies: 'kept' }`), unless the request sets `remove_copies` (`?remove_copies=1`, or `{ "remove_copies": true }`). Then every copy is deleted at the provider first (`copies: 'removed'`), and a refused copy stops the disconnect with 502 `copies_not_removed`.
  - Google's grant is still revoked first (#2413).
  - `POST /google/force-disconnect` keeps the copies too.
  - The next connect keeps the copies for the same account and drops them for another, via `calendar_sync_retained`.

