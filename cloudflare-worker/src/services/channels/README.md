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
