### Meeting bot control plane (D886 B1, #2579)

- POST/GET `/api/founder/validate/sessions/:id/bot`, POST `…/bot/stop`:
  `founder_validate_sessions.ts`; creator-only current project write scope.
- POST `/api/meeting-bots/:uid/events`, PUT `…/:uid/chunks/:seq`:
  `meeting_bot_callbacks.ts`; HMAC callbacks and short-lived one-use upload tokens.
- `MeetingBotRun` controls transitions, alarms, runtime leases and ledger blocks.
  Interface implementation only; no live runtime or public switch enabled by B1.
  B7 owns the UI. D886 §12 is the request/response contract.
- POST `/api/meeting-bots/diagnostics/:id/{report,screenshot,probe}`:
  `meeting_bot_callbacks.ts`; #3708's diagnostic callbacks, signed with the
  diagnostic's own derived key (`services/meetingBotDiagnose.ts`).
- POST `/api/admin/platform/meeting-bots/diagnose`, GET `…/diagnose/:id`,
  GET `…/diagnose/:id/screenshot`: `admin_platform.ts`; #3708's owner-run
  staged diagnostic. Super Admin only, the start behind TOTP and recent
  step-up; a diagnostic and its screenshot are read only by who started it.
- The diagnostic's `report` body is a cumulative snapshot (`diagnosis_id`,
  `revision`, per-stage `rev`, `at`, `attempts`); the Worker keeps the highest
  `rev` per stage, so repeats and out-of-order sends change nothing (D4857, #4857).

D886 B7 (#2585): Record a Session dispatches through the bot member routes, and
its session page polls status/Stop plus GET `…/sessions/:id/bot/participants`
(creator-only saved display names/times). Scheduled-call POST accepts
`auto_send_bot:false`; GET includes `bot`; DELETE stops the queued bot first.
No new public endpoint, runtime wiring or switch change.

D867 (#2513): the existing Telegram webhook's private `message` branch accepts
linked-member audio forwards and ordinary keyboard attestations only behind
`TELEGRAM_CAPTURE`. Its existing `channel_followup` dispatcher imports the
consented capture as recorder audio; no public route or callback subscription
is added. See `services/channels/telegramCapture.ts` and D867.

