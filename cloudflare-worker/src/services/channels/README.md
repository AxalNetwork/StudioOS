# services/channels

D684 (#1575). A member connects their **business** Telegram or WhatsApp
account, or schedules a Zoom or Google Meet call from an interview, and the
conversation reaches Validate › Interviews. Read
[D684](../../../../documentation/architecture/decisions/D684.md) first.

| File | What it owns |
| --- | --- |
| `types.ts` | The contract every adapter codes against: providers, limits, the normalised inbound events, `SendResult`, `ImportedSegment`. |
| `events.ts` | Every webhook event once. `claimEvent` is the idempotency boundary for all four providers; `releaseEvent` lets a retry through when nothing was stored. Also hashed-subject/hour link-attempt counters (migration 458), which fail closed and are purged after two days, and the per-connection counters, held in D1 (`channel_counters`, migration 451): the per-minute webhook limit, which fails open, and the daily voice-transcription cap, which fails closed. |
| `connections.ts` | Who an event belongs to, from the connection it arrived on and nothing else; whether a provider’s platform secrets exist (names only); and independent chat rollout checks through `channelRollout`, `channelOpenTo` and `channelOpenToMember` (D754/D756). |
| `linkCodes.ts` | One-time codes proving a Telegram account is the member's. SHA-256 only, ten minutes, once. Redeeming one records the Telegram account that sent it; that account's own `/confirm` and the signed-in Axal member's confirmation must both arrive within the original ten minutes. Pending identity details are encrypted, read only by the issuing member; migration 458. D754 way B reuses it for `whatsapp_link` codes (migration 492), where the claimant is an HMAC of the sender's WhatsApp id. |
| `whatsappLink.ts` | D754 way B, "Send to Axal" (#1937): a member's own WhatsApp linked through **Axal's own number**. `LINK <code>` from their WhatsApp proves the number, Axal's Confirm proves the account, both inside the code's ten minutes; then an `integrations` row `whatsapp_link` holds an HMAC of the number (`external_account_id`, one member per number by migration 492's index), the number encrypted (`credentials_enc`) and `•••• 1234`. STOP from the number or DELETE in Axal unlinks; a link unused for 180 days lapses in the purge. Every route is 503 and the webhook ignores Axal's number until all four `WHATSAPP_AXAL_*` settings are set. What a linked member forwards is part 2's (#1938, `whatsapp_captures`). |
| `providerHttp.ts` | Ten-second provider header/JSON deadline (`../../util/deadline.ts`), with an abort signal; a lost send response means unknown acceptance. |
| `outbound.ts` | Every message Axal sends for a member. A repeated `client_key` never sends twice; an ambiguous send remains pending with `send_unknown`, never failed; only WhatsApp moves a send past `submitted`, in one conditional UPDATE so two reports at once never move it backwards. The echo check (`isOurSend`) is scoped to the member. |
| `threads.ts` | The pending-thread store: messages wait encrypted until the member assigns the chat to an interview or ignores it, then move or go; purged after 30 days. A voice note waits as a placeholder (no text, its file ref encrypted) and is transcribed only once its chat is in an interview. An ignored chat stays a tombstone, with no text, for as long as its contact keeps writing. A chat whose provider asks for consent (WhatsApp, D754) links to its interview and waits: nothing moves and no voice note is fetched until its consent is given (`admitConsentedThread`); a decline or withdrawal sets it aside, and an empty waiting draft goes after 30 days. Consented WhatsApp audio becomes recorder audio once #1935 lands; Telegram stays text-only until D756. |
| `telegram.ts` | The Telegram Business adapter (S19): the webhook's secret header, Updates normalised (message ids as `<chat>:<message_id>`, unique across chats), `/start <code>`, `/confirm` and Axal Confirm linking (the Telegram account's owner agrees, told which Axal account is asking) and `business_connection` rows, `sendMessage`, `getFile` (≤ 20 MB) and `setWebhook`. The bot is `TELEGRAM_CHANNEL_BOT_TOKEN`, never the news bot. |
| `whatsapp.ts` | The WhatsApp Business adapter (S19): the GET challenge and the POST `X-Hub-Signature-256` over the raw body, `messages` / `statuses` / `smb_message_echoes` normalised, Embedded Signup (code → token encrypted with `../../integrations/secrets.ts`, number checked against the WABA, app subscribed), text sends, the consent notice as reply buttons (`sendWhatsAppInteractive`), and media downloads on Graph API `v23.0`. A contact's consent button, or a whole YES / NO / STOP, is normalised as a `consent_reply` (D754). Axal’s own number and WABA cannot be claimed; its WABA is never unsubscribed by a member. Disconnecting another WABA unsubscribes only when no other member’s number is in it. The Worker hands `GRAPH_VERSION` to the browser. |
| `voiceFailures.ts` | A voice note that was not transcribed, told on its thread (#1586): why (the budget, AI switched off, the day's cap, too large, unreadable, an expired connection, the provider unreachable after `VOICE_TRIES`, still trying, or `no_consent` while the chat waits for consent), in our words, kept as a code on its waiting placeholder (`channel_thread_messages.transcribe_error`, migration 454), the WhatsApp-only `voice_fetch_by` deadline and non-retryable `expired` reason, and the retry, which re-queues the note through `threads.ts` once the budget allows. |
| `consent.ts` | D754 (#1893): the interviewee's consent in the chat (`channel_consents`, migration 488). The notice's words per version, its server-built client keys (`consent:`), the window and the two-notice cap, the open request, the interviewee's answer (`recordReply`: only the contact's own, on its own chat, to its own request's notice, once), the member's word (`attest`, once a notice was delivered), the withdrawal, and the consent view a thread or a session reads. |
| `consentNotice.ts` | D756 §1.7 / D754 §5: the one notice version every consent row stores, and the link to the interviewee's notice page (`/privacy/interviews?n=<version>`), null without an https base URL. |
| `meetings.ts` | A Zoom or Meet call an interview scheduled (`interview_channel_refs`), from creation to imported transcript (S18): the ref's states, `MEETING_ERRORS` (the plain sentence `last_error` holds, and its code), and `importMeetingRef`, the one import path both providers' `meeting_import` jobs and the retry route run — through `../interviewIntake.ts`'s `importTranscript`. |
| `zoom.ts` | The Zoom adapter (S18): the `zoom` Connectors-registry OAuth provider (PKCE, tokens encrypted by the route layer, refresh under a KV lease), `createMeeting` / `cancelMeeting` on the member's account, the webhook (url_validation, `x-zm-signature` over `v0:{ts}:{raw body}` within five minutes), `parseVtt`, the transcript fetch with the member's token, and a daily sweep for calls that sent no transcript event. |
| `googleMeet.ts` | The Google Meet adapter (S18): a Calendar event with a Meet conference on the member's existing Google connection (`../calendar.ts`'s token store, no second one), Meet REST v2 conference records, transcripts and entries, and the sweep that polls ended calls (Meet has no push). Reading transcripts needs `meetings.space.readonly`, asked by `POST /api/calendar/google/meet-transcripts/connect` only while `MEET_TRANSCRIPTS_ENABLED` is on (D757, #1926); without the grant the ref says Meet transcripts are not available and the recorder or a pasted conversation will do. |

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

## Rules for adding here

- WhatsApp and Telegram are behind `WHATSAPP_CHANNEL` and `TELEGRAM_CHANNEL` (D754, D756 §1.1): `canary` is Super Admins only, `off` stores nothing. A new chat-channel path asks `channelOpenTo` or `channelOpenToMember`.
- A WhatsApp media id lapses after 7 days (D754 §6). Telegram has no deadline. The clock alone does not refuse a fetch; only an eligible late lookup refusal is `expired`.

- An adapter (`telegram`, `whatsapp`, `zoom`, `googleMeet`) verifies a request,
  normalises it into `types.ts` shapes, and talks to its provider. It never
  writes `discovery_interviews`, `interview_sessions` or
  `interview_transcript_segments`: that goes through `../interviewIntake.ts` and
  `threads.ts`.
- Tenancy comes from `connections.ts`. Never take a user, venture or interview
  id from a webhook payload.
- No message text in logs, `channel_events`, errors or analytics. Pending text
  is encrypted with columnCipher; once assigned it lives only in the transcript.
- Nothing from a chat is kept in an interview before consent where its
  provider asks for it (`consentRequired`, D754): its text stays pending, its
  voice notes are never fetched, and the gate refuses Structure, Ask and the
  summary. Client keys starting `consent:` are the server's own notices; the
  reply route refuses them from a browser.
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
  until its next Test. D754 adds `inbound` and `outbound` reason lists; region restrictions apply to outbound only, and both sides remain unavailable.

  **D754 adds a reason no number can get past (#1871).** Every member number
  is onboarded in coexistence mode, and calls on a coexistence number are
  reported to stay in the WhatsApp Business app, so none reaches the Calling
  API. The webhook therefore never subscribes `calls`.

## Switching WhatsApp on

The owner's steps, the live check on a real phone, what members see in each
state and the rollback are in `documentation/operations/WHATSAPP.md`; the
secrets and the `WHATSAPP_CHANNEL` rollout var are listed in
`documentation/architecture/PRODUCTION.md`. The live smoke
(`scripts/check-spa-live.mjs`) fails if the WhatsApp webhook ever accepts an
unsigned POST.
