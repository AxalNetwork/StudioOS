# services/channels

D684 (#1575). A member connects their **business** Telegram or WhatsApp
account, or schedules a Zoom or Google Meet call from an interview, and the
conversation reaches Validate › Interviews. Read
[D684](../../../../documentation/architecture/decisions/D684.md) first.

| File | What it owns |
| --- | --- |
| `types.ts` | The contract every adapter codes against: providers, limits, the normalised inbound events, `SendResult`, `ImportedSegment`. |
| `events.ts` | Every webhook event once. `claimEvent` is the idempotency boundary for all four providers; `releaseEvent` lets a retry through when nothing was stored. |
| `connections.ts` | Who an event belongs to, from the connection it arrived on and nothing else; and whether a provider's platform secrets exist (names only). |
| `linkCodes.ts` | One-time codes proving a Telegram account is the member's. SHA-256 only, ten minutes, once. |
| `outbound.ts` | Every message Axal sends for a member. A repeated `client_key` never sends twice; only WhatsApp moves a send past `submitted`. |
| `threads.ts` | The pending-thread store: messages wait encrypted until the member assigns the chat to an interview or ignores it, then move or go; purged after 30 days. |
| `telegram.ts` | The Telegram Business adapter (S19): the webhook's secret header, Updates normalised (message ids as `<chat>:<message_id>`, unique across chats), `/start <code>` linking and `business_connection` rows, `sendMessage`, `getFile` (≤ 20 MB) and `setWebhook`. The bot is `TELEGRAM_CHANNEL_BOT_TOKEN`, never the news bot. |
| `whatsapp.ts` | The WhatsApp Business adapter (S19): the GET challenge and the POST `X-Hub-Signature-256` over the raw body, `messages` / `statuses` / `smb_message_echoes` normalised, Embedded Signup (code → token encrypted with `../../integrations/secrets.ts`, number checked against the WABA, app subscribed), text sends and media downloads on Graph API `v23.0`. |
| `meetings.ts` | A Zoom or Meet call an interview scheduled (`interview_channel_refs`), from creation to imported transcript (S18): the ref's states, `MEETING_ERRORS` (the plain sentence `last_error` holds, and its code), and `importMeetingRef`, the one import path both providers' `meeting_import` jobs and the retry route run — through `../interviewIntake.ts`'s `importTranscript`. |
| `zoom.ts` | The Zoom adapter (S18): the `zoom` Connectors-registry OAuth provider (PKCE, tokens encrypted by the route layer, refresh under a KV lease), `createMeeting` / `cancelMeeting` on the member's account, the webhook (url_validation, `x-zm-signature` over `v0:{ts}:{raw body}` within five minutes), `parseVtt`, the transcript fetch with the member's token, and a daily sweep for calls that sent no transcript event. |
| `googleMeet.ts` | The Google Meet adapter (S18): a Calendar event with a Meet conference on the member's existing Google connection (`../calendar.ts`'s token store, no second one), Meet REST v2 conference records, transcripts and entries, and the sweep that polls ended calls (Meet has no push). Reading transcripts needs `meetings.space.readonly`; without it the ref says Google must be reconnected. |

The routes, the webhook pipeline and the voice-note job for both live in
`../../routes/channels.ts`. The meetings routes and the public Zoom webhook
live in `../../routes/founder_validate_meetings.ts`.

## Rules for adding here

- An adapter (`telegram`, `whatsapp`, `zoom`, `googleMeet`) verifies a request,
  normalises it into `types.ts` shapes, and talks to its provider. It never
  writes `discovery_interviews`, `interview_sessions` or
  `interview_transcript_segments`: that goes through `../interviewIntake.ts` and
  `threads.ts`.
- Tenancy comes from `connections.ts`. Never take a user, venture or interview
  id from a webhook payload.
- No message text in logs, `channel_events`, errors or analytics. Pending text
  is encrypted with columnCipher; once assigned it lives only in the transcript.
- A provider capability Axal cannot use (Telegram calls, WhatsApp Calling
  before its gates are met) is stated as unavailable, never simulated.

## Calls

Neither messaging channel brings calls into an interview in this phase, and
nothing here pretends to.

- **Telegram.** The Bot API has no call methods: a bot cannot place, answer
  or record a Telegram call, on a business account or anywhere else. What a
  member can use instead: **voice notes**, which arrive on the business
  connection and are transcribed into the thread like typed messages (only
  the text is kept), and the **in-app recorder** (channel `phone`) for a
  Telegram call held on speaker.
- **WhatsApp.** The Cloud API does have **WhatsApp Calling** (user-initiated
  and business-initiated voice calls, signalled through the Graph API and the
  `calls` webhook), but it is gated, and the gates are the member's number's,
  not Axal's:
  - it is off by default, and a number qualifies only once its messaging
    limit is at least 2,000 business-initiated conversations a day;
  - a business-initiated call needs the customer's permission first (a
    call permission request), and business-initiated calls are not offered
    in some countries (D684 §3 lists the US, Canada, Egypt, Vietnam and
    Nigeria as of 2026-10-13; Meta's list changes);
  - the media is WebRTC or SIP that the **business terminates itself** —
    Meta exposes no recording and no transcript.

  **Phase 2 plan only:** the member's browser answers a customer's call
  (Graph API pre-accept/accept with the SDP from the `calls` webhook) and
  records it through the existing chunk recorder and transcription. It needs
  the owner's go and a per-number eligibility check. Until then the
  Connectors card says "Calls: not yet" and no call is simulated, queued or
  faked anywhere.
