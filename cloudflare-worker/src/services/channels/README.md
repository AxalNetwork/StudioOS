# services/channels

D684 (#1575). A member connects their **business** Telegram or WhatsApp
account, or schedules a Zoom or Google Meet call from an interview, and the
conversation reaches Validate › Interviews. Read
[D684](../../../../documentation/architecture/decisions/D684.md) first.

| File | What it owns |
| --- | --- |
| `types.ts` | The contract every adapter codes against: providers, limits, the normalised inbound events, `SendResult`, `ImportedSegment`. |
| `events.ts` | Every webhook event once. `claimEvent` is the idempotency boundary for all four providers; `releaseEvent` lets a retry through when nothing was stored. Also hashed-subject/hour link-attempt counters (migration 458), which fail closed and are purged after two days, and the per-connection counters, held in D1 (`channel_counters`, migration 451): the per-minute webhook limit, which fails open, and the daily voice-transcription cap, which fails closed. |
| `connections.ts` | Who an event belongs to, from the connection it arrived on and nothing else; and whether a provider's platform secrets exist (names only). |
| `linkCodes.ts` | One-time codes proving a Telegram account is the member's. SHA-256 only, ten minutes, once. Redeeming one records the Telegram account that sent it; that account's own `/confirm` and the signed-in Axal member's confirmation must both arrive within the original ten minutes. Pending identity details are encrypted, read only by the issuing member; migration 458. D754 way B reuses it for `whatsapp_link` codes (migration 492), where the claimant is an HMAC of the sender's WhatsApp id. |
| `whatsappLink.ts` | D754 way B, "Send to Axal" (#1937): a member's own WhatsApp linked through **Axal's own number**. `LINK <code>` from their WhatsApp proves the number, Axal's Confirm proves the account, both inside the code's ten minutes; then an `integrations` row `whatsapp_link` holds an HMAC of the number (`external_account_id`, one member per number by migration 492's index), the number encrypted (`credentials_enc`) and `•••• 1234`. STOP from the number or DELETE in Axal unlinks; a link unused for 180 days lapses in the purge. Every route is 503 and the webhook ignores Axal's number until all four `WHATSAPP_AXAL_*` settings are set. What a linked member forwards is part 2's (#1938, `whatsapp_captures`). |
| `providerHttp.ts` | Ten-second provider header/JSON deadline (`../../util/deadline.ts`), with an abort signal; a lost send response means unknown acceptance. |
| `outbound.ts` | Every message Axal sends for a member. A repeated `client_key` never sends twice; an ambiguous send remains pending with `send_unknown`, never failed; only WhatsApp moves a send past `submitted`, in one conditional UPDATE so two reports at once never move it backwards. The echo check (`isOurSend`) is scoped to the member. |
| `threads.ts` | The pending-thread store: messages wait encrypted until the member assigns the chat to an interview or ignores it, then move or go; purged after 30 days. A voice note waits as a placeholder (no text, its file ref encrypted) and is transcribed only once its chat is in an interview. An ignored chat stays a tombstone, with no text, for as long as its contact keeps writing. |
| `telegram.ts` | The Telegram Business adapter (S19): the webhook's secret header, Updates normalised (message ids as `<chat>:<message_id>`, unique across chats), `/start <code>`, `/confirm` and Axal Confirm linking (the Telegram account's owner agrees, told which Axal account is asking) and `business_connection` rows, `sendMessage`, `getFile` (≤ 20 MB) and `setWebhook`. The bot is `TELEGRAM_CHANNEL_BOT_TOKEN`, never the news bot. |
| `whatsapp.ts` | The WhatsApp Business adapter (S19): the GET challenge and the POST `X-Hub-Signature-256` over the raw body, `messages` / `statuses` / `smb_message_echoes` normalised, Embedded Signup (code → token encrypted with `../../integrations/secrets.ts`, number checked against the WABA, app subscribed), text sends and media downloads on Graph API `v23.0`. Disconnecting unsubscribes the WABA only when no other member's number is in it. |
| `voiceFailures.ts` | A voice note that was not transcribed, told on its thread (#1586): why (the budget, AI switched off, the day's cap, too large, unreadable, an expired connection, the provider unreachable after `VOICE_TRIES`, or still trying), in our words, kept as a code on its waiting placeholder (`channel_thread_messages.transcribe_error`, migration 454), and the retry, which re-queues the note through `threads.ts` once the budget allows. |
| `meetings.ts` | A Zoom or Meet call an interview scheduled (`interview_channel_refs`), from creation to imported transcript (S18): the ref's states, `MEETING_ERRORS` (the plain sentence `last_error` holds, and its code), and `importMeetingRef`, the one import path both providers' `meeting_import` jobs and the retry route run — through `../interviewIntake.ts`'s `importTranscript`. |
| `zoom.ts` | The Zoom adapter (S18): the `zoom` Connectors-registry OAuth provider (PKCE, tokens encrypted by the route layer, refresh under a KV lease), `createMeeting` / `cancelMeeting` on the member's account, the webhook (url_validation, `x-zm-signature` over `v0:{ts}:{raw body}` within five minutes), `parseVtt`, the transcript fetch with the member's token, and a daily sweep for calls that sent no transcript event. |
| `googleMeet.ts` | The Google Meet adapter (S18): a Calendar event with a Meet conference on the member's existing Google connection (`../calendar.ts`'s token store, no second one), Meet REST v2 conference records, transcripts and entries, and the sweep that polls ended calls (Meet has no push). Reading transcripts needs `meetings.space.readonly`; without it the ref says Google must be reconnected. |

The routes, the webhook pipeline and the voice-note job for both live in
`../../routes/channels.ts`. The meetings routes and the public Zoom webhook
live in `../../routes/founder_validate_meetings.ts`.

## Telegram after D756

D756 (#1872) switches the Telegram Business bot on. The owner's steps, the
real-device check, rotation and the off switch are in
`documentation/operations/TELEGRAM.md`. As decided, and landing task by task
(the runbook's table says which PR carries each):

- **Media.** The normaliser reads `voice`, `audio`, `video_note` and an audio
  `document`, carrying the kind, the declared size and the declared MIME type
  in the encrypted voice reference (no migration). A note over 5 MB, the
  recorder's chunk limit, is refused on its declared size before any download,
  through one bounded, streamed download helper in `providerHttp.ts`. Round
  videos wait as placeholders and are not transcribed yet (#1896).
- **Consent.** No note of a chat is downloaded until the interviewee answers
  YES in the chat, through D754's provider-neutral consent store. Only the
  chat's own user counts, within 7 days of the notice; NO keeps the notes
  undownloaded, STOP stops later downloads. Telegram offers no member
  attestation, because the member can always paste the notice (#1977).
- **Audio.** After YES, each note is stored like the recorder's audio, as a
  chunk under `validate-audio/`, transcribed once with its speaker taken from
  the side, and kept until the member deletes the session (#1978). Until
  then, D684's text-only behaviour stands.


- An adapter (`telegram`, `whatsapp`, `zoom`, `googleMeet`) verifies a request,
  normalises it into `types.ts` shapes, and talks to its provider. It never
  writes `discovery_interviews`, `interview_sessions` or
  `interview_transcript_segments`: that goes through `../interviewIntake.ts` and
  `threads.ts`.
- Tenancy comes from `connections.ts`. Never take a user, venture or interview
  id from a webhook payload.
- No message text in logs, `channel_events`, errors or analytics. Pending text
  is encrypted with columnCipher; once assigned it lives only in the transcript.
- Nothing spends a member's AI budget on a chat they have not assigned: a
  stranger who writes in never runs a model. Queue jobs carry ids only — never
  a provider message id (a WhatsApp wamid is the customer's number in base64).
- A counter that must count faster than once a second per key lives in D1, not
  KV: KV takes one write per key per second.
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
  the owner's go. No call is simulated, queued or faked anywhere.

  **The eligibility check is built (#1586); the calling is not.** For each
  connected number, `whatsapp.ts` records what Calling would need in the
  integration's `config_json.calling`: Meta's `messaging_limit_tier` (read
  from Graph) and a region restriction derived from the number's calling code
  (`NG`, `EG`, `VN`, `US_CA` for +1, `none`, or null when unread). The number
  itself is never kept. It is recorded when the number connects
  (Embedded Signup) and refreshed by the card's Test. `GET /api/channels`
  turns it into `connections.whatsapp.calls` with `callingEligibility`: always
  `available: false`, with the reasons and the card's one line, "Calls: not
  yet, because Axal does not answer or place WhatsApp calls yet; this number
  can start 1,000 conversations a day, and WhatsApp Calling needs at least
  2,000; …". A number connected before #1586 says it has not been checked
  until its next Test.
