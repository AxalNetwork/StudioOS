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
- `registry.ts`: D1484 (#3977), the one list of sources (`SOURCES`): each
  kind's family, module and label in plain words (never a table name), and
  whether it is page only or pushable. `READERS`, `FAMILY_OF`,
  `COPYABLE_KINDS`, the route's `PUSHABLE_KINDS` and `PAGE_ONLY_KINDS` /
  `FEED_KINDS` are derived from it or asserted against it, and every page item
  carries `source`. D1484 also wires D1208's interview calls, cohort dates and
  deal closings and the `manual` reader for "New event", all page only and for
  their owner alone (`PERSONAL_ONLY_KINDS`: no staff scope lists them).
- `botCalls.ts`: D1486 §a (#3980), the meeting bot's runs (`meeting_bots`)
  as the `bot_call` kind: the member's own runs only, with epoch ms turned
  into ISO. `done` reads "Recorded", and "Transcript ready" appears only when
  the run's session holds its final transcript. Page only. It never reads
  the meeting link or the participants.
- `raiseDates.ts`: #3982 (D1486 §c), Raise's dated stores, page only and all
  day: `round_close` (an active round's close, for the venture's founder and
  its accepted owners and co-founders) and `nda_expiry` (an active, unvoided
  NDA's expiry, for its two parties only, by the other party's name).
- `prefs.ts`: D1484 part 2 (#3978, migration 708), a member's own source
  settings. `calendar_source_prefs` holds whether a source is shown and its
  colour, a palette token and never hex. `calendar_settings` holds
  `copy_target`. A missing row means "shown, family colour", and no default
  row is written. Every read and write is `WHERE user_id = ?` bound. Only the
  page read honours these settings (`hiddenKinds`); `.ics`, the feeds and the
  push never read them.
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
