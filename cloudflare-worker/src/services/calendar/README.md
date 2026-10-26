# Calendar services

Personal calendar reads, private subscription feeds and copies in connected
Google or Outlook calendars. The aggregator is `../calendar.ts`; HTTP gates
live in `../../routes/calendar.ts`.

- `items.ts` enriches the signed-in calendar page's items for its drawers and
  actions. Its extra fields never enter provider copies or subscription feeds.
- `sourceReaders.ts` reads the member's interview calls, cohort dates,
  compliance deadlines and deal closings. These sources are read only and
  retain recorded dates and ownership, including for Admins (D1208).
- `myEvents.ts` reads tickets and hosted events and identifies stale provider
  copies. Waitlist and payment state stay visible; join links obey event access.
- `investorMeetings.ts` reads a founder's investor meetings from Capital
  relationships, without inventing an end time or inviting the investor.
- `feedTokens.ts` mints and revokes per-member private feed tokens. Only their
  hashes are stored; whole-calendar and my-events scopes remain separate.
- `sync.ts` pushes, updates and removes tracked provider copies. Calendar sync
  must not break the underlying booking. Disconnect removes copies only when
  the member explicitly chose that option.
- `syncState.ts` records fixed sync error codes and retained-copy ownership
  markers. Provider error text, titles and addresses are never stored there.
- `cancelEvents.ts` removes cancelled event copies with bounded immediate
  cleanup and durable continuation/retry jobs.

Keep ownership checks in each source reader: an Admin's personal calendar
must not inherit access to another member's items. Bind every SQL value,
keep source ids distinct from provider copy ids, and preserve all-day date
semantics. New sources need their own recorded ownership boundary and tests;
never infer a time, attendee, provider account or invitation. Stub providers
in tests. See D1033, D1131, D1190 and D1207–D1209.
