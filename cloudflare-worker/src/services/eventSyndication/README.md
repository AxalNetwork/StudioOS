# services/eventSyndication

D1490 (#3904; the #3725 spec, Part A). An approved public event is also
listed on outside channels (Luma, Eventbrite, Google Business Profile,
LinkedIn, Facebook) through accounts HQ connects. This folder is the core:
the rule, the registry, the triggers and the job. Each channel lands in its
own task as a row in `channels.ts`. **Eventbrite is the first** (#3725,
D3725): built against a mocked Eventbrite API and switched off until the
owner adds Axal's Eventbrite app (`EVENTBRITE_CLIENT_ID` and
`EVENTBRITE_CLIENT_SECRET`). Read
[D1490](../../../../documentation/architecture/decisions/D1490.md) first.

| File | What it owns |
| --- | --- |
| `channels.ts` | The five channel keys and the adapter contract (`create`, `update`, `cancel`, `listGuests?`, `preview`, never `publish`, so D1319's walk stays green). `SYNDICATION_CHANNELS` holds Eventbrite, switched off by `enabled(env)`; `registerSyndicationChannel` is for a test's fake only, and a fake replaces the real row. |
| `channelError.ts` | `ChannelError`, a platform's refusal with its status and `Retry-After`. Its own module so an adapter imports it without an import cycle; `channels.ts` re-exports it. |
| `eventbrite.ts` | The Eventbrite adapter (#3725): OAuth connect to Axal's one organisation, an externally ticketed listing that sends every registration to the Axal page, update and cancel by the stored id. `enabled(env)` is false without both app secrets; `verified_on` stays null until checked live. |
| `eligibility.ts` | The one rule every route and the job ask: the public feed's predicate, a future start, HQ's `hosts` setting, an active account, HQ's or the host's own while allowed. The five skip sentences, and HQ's settings (`platform_settings` key `event_syndication`). |
| `content.ts` | What a listing is sent (`listingEvent`), the hash over every sent field that says it changed (`contentHash`), and the link back to the event's page with its `utm_source`. |
| `hooks.ts` | The four triggers called by `cloudflare-worker/src/routes/events.ts` and `cloudflare-worker/src/routes/admin_events.ts`: approve, edit, cancel and unpublish. Each is one bound UPDATE and one keyed job per row; a failure never fails the event write. |
| `jobs.ts` | The `event_syndication` job: the run-time eligibility check, the adapter call, the row and its log row, the cleaned failure reason, and the dead-letter end. |
| `copyAssist.ts` | D1493 (SY8): Ask proposes one channel's title and description. The rail option `draft:syndication-copy`, its page (`<Profile> · Events`) and record (`events:<id>`), the prompt, and the answer turned into one proposal per field, cut to the channel's limit. Pure; `cloudflare-worker/src/routes/event_syndication_assist.ts` runs it. |

## Rules for adding here

- A new channel is a row in `SYNDICATION_CHANNELS`, with its `verified_on`
  date, in its own task. Never call `registerSyndicationChannel` from `src/`.
- A channel built before its account exists carries `enabled(env)`;
  `syndicationChannel(key, env)` then answers null, so it reads "Not
  available yet" exactly as a channel with no adapter. Pass `env` wherever
  there is one.
- No method is called `publish`. Syndication is not founder publishing.
- Credentials go through `cloudflare-worker/src/integrations/secrets.ts` (`encryptChannelCredentials`)
  and are never selected by a read. A log `detail` is a sentence: never a
  token, never an attendee's email.
- Every status change is a guarded UPDATE, so a repeated message does nothing.
