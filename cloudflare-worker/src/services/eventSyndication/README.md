# services/eventSyndication

D1490 (#3904; the #3725 spec, Part A). An approved public event is also
listed on outside channels (Luma, Eventbrite, Google Business Profile,
LinkedIn, Facebook) through accounts HQ connects. This folder is the core:
the rule, the registry, the triggers and the job. **It has no adapter yet**:
each channel lands in its own task (D1492 Luma first) as a row in
`channels.ts`. Read
[D1490](../../../../documentation/architecture/decisions/D1490.md) first.

| File | What it owns |
| --- | --- |
| `channels.ts` | The five channel keys and the adapter contract (`create`, `update`, `cancel`, `listGuests?`, `preview`, never `publish`, so D1319's walk stays green). `SYNDICATION_CHANNELS` is empty; `registerSyndicationChannel` is for a test's fake only. |
| `eligibility.ts` | The one rule every route and the job ask: the public feed's predicate, a future start, HQ's `hosts` setting, an active account, HQ's or the host's own while allowed. The five skip sentences, and HQ's settings (`platform_settings` key `event_syndication`). |
| `content.ts` | What a listing is sent (`listingEvent`), the hash over every sent field that says it changed (`contentHash`), and the link back to the event's page with its `utm_source`. |
| `hooks.ts` | The four triggers called by `routes/events.ts` and `routes/admin_events.ts`: approve, edit, cancel and unpublish. Each is one bound UPDATE and one keyed job per row; a failure never fails the event write. |
| `jobs.ts` | The `event_syndication` job: the run-time eligibility check, the adapter call, the row and its log row, the cleaned failure reason, and the dead-letter end. |

## Rules for adding here

- A new channel is a row in `SYNDICATION_CHANNELS`, with its `verified_on`
  date, in its own task. Never call `registerSyndicationChannel` from `src/`.
- No method is called `publish`. Syndication is not founder publishing.
- Credentials go through `integrations/secrets.ts` (`encryptChannelCredentials`)
  and are never selected by a read. A log `detail` is a sentence: never a
  token, never an attendee's email.
- Every status change is a guarded UPDATE, so a repeated message does nothing.
