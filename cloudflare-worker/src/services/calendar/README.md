# Personal Calendar helpers

These helpers support `../calendar.ts` and `../../routes/calendar.ts`. The
calendar is personal: a wider studio role does not widen a member's Mine
feed or its source reads.

- `items.ts` enriches the page's item drawers with recorded fields, families
  and action states. It does not add those details to feeds or provider copies.
- `myEvents.ts` reads the member's event registrations and hosted events,
  retaining seat/payment states and the standing join-link permission.
- `investorMeetings.ts` reads the venture founder's recorded prospect meetings
  with a start time. It invents no time, attendee or invitation.
- `sourceReaders.ts` reads owner-scoped interview calls, cohort dates,
  compliance deadlines and deal closing dates. It makes no provider calls.
- `feedTokens.ts` mints and verifies separate revocable tokens for My events
  and the whole calendar. Only token hashes are stored; tokens never enter paths.
- `sync.ts` copies eligible items to the member's connected Google or Outlook
  calendar, tracks provider mappings and handles updates/cancellations.
- `syncState.ts` records fixed sync-error codes and timestamps, plus account
  markers for retained copies across disconnect/reconnect. Provider error text
  is not stored.
- `cancelEvents.ts` performs bounded event-copy cleanup and queues durable
  continuation/retry. It rechecks source state before deleting a provider copy.

When adding a source, preserve its owner and participant gates, stable source
identity and recorded timing. Missing data stays missing; a failed read is not
an empty calendar. Keep page-only details out of feeds/provider copies and keep
calendar-provider credentials, event text and addresses out of logs. Extend
both the allowed and refused cases in the corresponding calendar tests.
