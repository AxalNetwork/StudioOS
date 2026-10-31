# Calendar services

Personal calendar sources and the bookkeeping for external calendar copies.
The routes gate the member before calling these services. Keep page-only detail
projection separate from feeds and provider sync, and preserve source ownership
when adding a kind.

- `myEvents.ts`: the member's event registrations and hosted events as calendar
  items, plus per-event add-to-calendar links.
- `feedTokens.ts`: the member's subscription token, returned once; only its hash
  is stored. Replacing or revoking it invalidates the previous feed address.
- `investorMeetings.ts`: dated Capital relationships meetings on the venture
  founder's own calendar, without inviting anyone.
- `sourceReaders.ts`: personal interview calls, cohort dates, compliance due
  dates and deal closings as read-only calendar sources; no provider calls.
  D1384 wires compliance into `READERS` as `compliance_due`, the Compliance
  layer that replaced /compliance: done deadlines on the page read only, the
  active company passed in, and never in a feed (`PAGE_ONLY_KINDS`).
- `items.ts`: page-only drawer fields for calendar items. Feed and provider
  projections keep their separate, smaller event shape.
- `itemRead.ts`: one item for the drawer (the page read's own reader and
  description, people by name only), and a Meet link made at create that becomes
  the creator's Google copy.
- `sync.ts`: create, update and cancellation hooks for copies of Axal-booked
  sessions on the member's connected Google or Outlook calendar.
- `cancelEvents.ts`: bounded immediate cleanup and durable continuation for a
  cancelled registration or event, rechecking source state before deletion.
- `syncState.ts`: fixed sync-error codes and retained-copy/disconnection state;
  no provider response text is stored as an error.

Add readers beside the source they represent and test member boundaries with
synthetic data. Tests stub provider calls. Never log feed tokens, provider
credentials, titles, addresses or response bodies. A missing or failed source
must remain distinguishable from a known empty calendar.
