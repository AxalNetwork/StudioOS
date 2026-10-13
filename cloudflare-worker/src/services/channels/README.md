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

## Messaging adapters (#1576)

- Telegram verifies a hashed secret with constantTimeEqual and normalizes only
  private /start and Business updates. Business rights supersede can_reply.
  Message ids include connection and chat to avoid numeric-id collisions.
- WhatsApp verifies HMAC over the raw bytes, independently of the GET challenge.
  App echoes are Me; status updates are scoped to the number's member.
  Signup verifies the token's app, scopes, WABA and phone-number membership
  before subscribing; credentials use the existing encrypted integrations blob.
- The route module exports channels for /api/channels and adminChannels for
  /api/admin/channels. S01 mounts them and exempts only the messaging webhook
  paths from signed-in middleware. Management paths still authenticate inside.
- Unknown/unlinked connections store nothing. Link Telegram before attaching
  the bot to Telegram Business. If linking consumes a code but storing the
  connection fails, issue a new code; consumed codes cannot be replayed.
- Provider calls and their response bodies have a deadline, redirect refusal
  and byte caps. Voice downloads are capped at 20 MB, kept in memory, and run
  through aiRouter's transcribe task under the connection owner's D640 budget.
  Only transcript text is retained. Queue metadata is encrypted; events contain
  only hashed identifiers and machine outcomes.
- KV limits use a hashed per-connection/minute bucket. As with existing KV
  limits, concurrent deliveries can exceed a bucket slightly: KV is not an
  atomic counter. Missing/unreadable KV fails closed. Raw bodies cap at 256 KB.
- Replies require rights and an open window. Idempotent client keys never
  trigger a second send. A provider acceptance is submitted, never delivered
  for Telegram. WhatsApp delivery comes only from signed status webhooks.

## Calls

Telegram bots have no call API: they cannot place or answer Telegram calls.

WhatsApp Calling is phase 2 only. It requires a business messaging limit of
at least 2,000, eligible countries and a real WebRTC (or SIP) media endpoint.
Business-initiated calls additionally require customer call permission and are
unavailable in the US, Canada, Egypt, Vietnam and Nigeria. Meta provides no
recording API: the endpoint must handle media itself. A later owner-approved
phase needs eligibility checks, permission storage, call signalling/webhooks,
a secured media endpoint and explicit recording consent. This implementation
does not advertise or simulate call support.
