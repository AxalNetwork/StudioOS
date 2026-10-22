# meeting-bot

Axal's own meeting bot (D886, tracked in #2577). It joins a Zoom, Google Meet
or Microsoft Teams call as **"Eadwyn AI"**, posts the recording notice in the
meeting chat, and records the call's audio, the participant roster and the
active-speaker timeline. The Worker turns that into a session with named
speakers.

This folder is the bot **runtime**, the part that sits in the call. The
Worker's control plane (the routes, the `MeetingBotRun` Durable Object, the
callback, consent and metering) is B1's (#2579), under `cloudflare-worker/`.

**Not deployed yet.** B0 (#2578) chooses the host (Cloudflare Containers or a
VM) and whether the runtime builds on Attendee. B8 (#2586) packages this
folder as that host's image and deploys it. Until then this is a library with
tests, and nothing here runs in production.

## What is here (B2, #2580)

The platform-independent core, with no dependencies. Node 22 runs the
TypeScript directly (type stripping), so there is no build step.

| Folder | What it holds |
| --- | --- |
| `src/` | The core: the adapter contract, the lifecycle, audio chunks, events, the callback client, the log rule and the fake adapter. |
| `test/` | The core's tests, run by `npm run test:meeting-bot` (part of `test:drift`, so CI runs them on every PR), and their fake clock and stub callback (`_harness.ts`). |

| File | What it owns |
| --- | --- |
| `src/types.ts` | `MeetingAdapter`, the contract B3 (Meet), B4 (Zoom) and B5 (Teams) each implement: `join`, `admitted`, `sendChat`, `audio`, `roster`, `speakers`, `ended`, `leave`. Also `RunConfig` (what B1's Durable Object hands the runtime), the event and status shapes, `CallbackTransport` and D886's failure codes. |
| `src/constants.ts` | The bot's name, D872's audio format, ~30-second chunks, two minutes alone, the plan limits (30 minutes free, 2 hours paid), the admission wait, batching and retry. |
| `src/lifecycle.ts` | `runBot`: joining → waiting room → notice → recording → left, or failed with a code. |
| `src/wav.ts` | `encodeWav` (D872's canonical 44-byte header, byte for byte), `Chunker` (~30 s parts with `seq` and `start_ms`) and `toPcm16k` for browser audio. |
| `src/uploader.ts` | `ChunkUploader`: chunks sent as they complete, in order, retried with backoff, idempotent by `seq`; `drain` at the end. |
| `src/events.ts` | `EventBatcher`: roster and speaker events numbered `n`, timed `at_ms` from recording start, batched to the callback. |
| `src/callback.ts` | `httpTransport`: signed POSTs to the run's callback and the one-time chunk URL, with deadlines and no redirects. **Provisional:** its paths (`CALLBACK_PATHS`) and signature (`signRequest`) follow B1's contract once #2579 publishes it. |
| `src/log.ts` | The only way a log line is written: codes and counts, nothing else (`safeFields`). |
| `src/fakeAdapter.ts` | A scripted platform for the tests, and the reference implementation an adapter copies. |
| `src/index.ts` | The public exports. |
| `notice.mjs` | B9's notice contract (#2587, #2590): `meetingBotNotice`, `MEETING_BOT_NAME`, the publication gate and the dispatch disclosure. See **The notice** below. |

## The run

1. **Join.** B1's Durable Object starts the run with a `RunConfig`: the run
   id, the platform, the meeting link, the notice text and the founder's plan
   limit. A limit over 2 hours or an empty notice is refused before anything
   is joined. A link that is not https fails as `link_invalid` without being
   opened.
2. **Wait.** The bot reports `waiting_room` until the host admits it. A
   refusal, or ten minutes without admission, is `not_admitted`. Stop from the
   waiting room leaves with nothing recorded.
3. **Notice first.** Once admitted, the bot posts the notice in the meeting
   chat **before** it subscribes to audio, the roster or the speakers. The
   notice's words are D886's, sent by the Worker in `RunConfig.notice`. If the
   chat refuses the notice three times, the run fails as `platform_blocked`
   and nothing is heard.
4. **Record.** Audio arrives from the adapter as 16 kHz mono 16-bit PCM. It
   is cut into ~30-second WAV chunks (960,044 bytes) and uploaded as each one
   completes. Roster and speaker events go in batches every 5 seconds, or at
   50.
5. **Leave.** The bot leaves when the call ends (`call_ended`), after two
   minutes as the only one there (`alone`), on Stop (`stopped`), or at the plan
   limit (`time_limit`). Then it sends the last partial chunk, retries anything
   unsent, flushes the events and reports `left` with counts.

**Failure codes** (D886): `not_admitted`, `meeting_ended`, `link_invalid`,
`platform_blocked`, `obf_unavailable` (Zoom). An adapter raises one as an
`AdapterFailure`; any other error reads as `platform_blocked`, and the
adapter's own message is never kept.

## The notice (B9, #2590)

`notice.mjs` is B9's dependency-free notice contract. Import `meetingBotNotice`
and `MEETING_BOT_NAME` from it. The caller supplies the authorized venture's
display name, never a meeting link, passcode or instructions from chat.
The gated function refuses while `MEETING_BOT_NOTICE_PUBLISHED` is false.
The public page uses that same publication gate. The announcement links to
the matching notice version, not the default legacy page. B1 must refuse
dispatch and scheduled starts while this gate is false, even in canary.
`draftMeetingBotNotice` is for tests and approval previews only; it is never
the runtime entry. Publishing requires B1/B2/B6 safeguards to be verified.
Set the actual `MEETING_BOT_NOTICE_APPROVED_AT` date after approval and those
checks. A valid date derives the shared publication gate, publishes version 2,
makes it current and supplies the page's update date together. A missing or
invalid date cannot publish. Legacy chat-consent links retain version 1.

After publication the notice returns plain text. B2 posts it once after
admission and before capturing audio. B2 owns the durable once-only record, failure handling and
the stop/leave behavior; importing this module implements none of those.

The founder has already confirmed recording consent before dispatch. The
announcement does not obtain that agreement. B7 imports the same module's
`MEETING_BOT_DISPATCH_DISCLOSURE` beside D757's existing consent control;
`MeetingBotConsentNotice.jsx` is its presentational wrapper.

Owner steps, failure codes and live checks are in
`documentation/operations/MEETING_BOT.md`. Never print meeting URLs,
credentials, display names, roster contents or transcript text in logs or
GitHub reports. Report counts and states only.

**How B2 uses it.** `runBot` takes the notice as text in `RunConfig.notice` and posts it once, after admission and before it subscribes to any audio, roster or speaker (`src/lifecycle.ts`). The run's entry point (B8) builds that text with `meetingBotNotice`, so while the gate is false there is no text and no run. `BOT_NAME` in `src/constants.ts` is `MEETING_BOT_NAME`, so the name lives in one place.

## Writing an adapter (B3–B5)

Implement `MeetingAdapter` in `src/adapters/<platform>.ts` and keep the
contract `fakeAdapter.ts` shows:

- `roster` reports everyone already in the call as a `join` when subscribed,
  then each change. It never reports the bot. `key` is the platform's id for
  that participant in this call; `name` is their display label, which is
  never proof of who they are (D876 §3).
- `speakers` reports the platform's own active-speaker indicator. The core
  drops repeats.
- `audio` frames are 16 kHz mono 16-bit PCM. A browser's 48 kHz float audio
  goes through `toPcm16k`.
- Refusals are `AdapterFailure`s with D886's codes. `leave` is safe to call
  twice, and after the call ended.

Then add a test that drives the adapter against the same lifecycle the fake
does.

## Rules

- **Privacy (#2577).** No meeting link, passcode, participant name or
  transcript text in a log line, an issue or a PR. Log through `logLine`
  only. It writes numbers, booleans and the bot's own codes, and drops every
  other string. `test/callback_privacy.test.ts` runs a whole call with a
  passcode in the link and checks every line.
- **Idempotent by design.** A chunk's `seq` and an event's `n` let the Worker
  drop a repeat. So the bot always resends when it is unsure, and never skips
  something it does not know was stored.
- **No dependencies** in the core. An adapter may need a browser (Playwright
  and Chromium for Meet and Teams) or the Zoom Meeting SDK. Those belong to
  the adapter and the image (B8), not here.
- **The Worker decides.** The Durable Object is the only writer of a run's
  status. The bot reports what happened; it never decides what the founder
  sees.

## Zoom adapter boundary (B4, #2582)

`src/zoomAdapter.ts` implements `MeetingAdapter` with an injected
`ZoomSdkBridge`. Import it directly; the core's shared exports are unchanged.
This is orchestration tested against fakes, **not a packaged Linux SDK client**.
B8 must supply the native bridge and B1 must supply a founder-scoped OBF mint
through the existing Worker helper. Neither SDK JWT signing keys nor OAuth
access tokens belong in this adapter. OBF tokens exist only as local join
arguments; the native bridge must discard them after each attempt.

The bridge contract maps Linux SDK join/admission, chat, audio join,
`CanStartRawRecording`, host recording privilege, `StartRawRecording`, mixed
raw audio, participant/active-speaker callbacks and meeting end. It must:

- honor every AbortSignal, including a Stop during a pending mint or join;
- emit current roster on subscription, updates and renames under stable keys;
- deliver only 16 kHz mono PCM, without replaying media buffered before notice;
- signal end immediately on recording privilege loss or the authorizing user's
  departure; do not silently reconnect with another user's token;
- translate native failures into `ZoomJoinFailure` codes and suppress native
  debug logs that contain URLs, names, passcodes or credentials;
- release every callback and SDK object on leave, including failed joins.

The adapter requests a fresh single-use OBF on every join attempt. Only the
explicit authorizing-user-absent error retries, every 3 seconds, at most 120
attempts. `waitingForHost` is an explicit B1 integration hook, for the sentence
"Join the call first; Eadwyn AI follows." It must report that state through the
control plane. B2's current `BotState` does not yet contain it.

After admission the core posts the notice. Only then does the adapter join
audio, check/request the host's recording permission and start raw recording.
Refusal prevents audio subscriptions. The adapter copies borrowed PCM memory,
filters the bot's own roster entry, maps its speaker indicator to silence and
makes leave idempotent.

**Mixed audio only in this revision.** B2's `AudioFrame`/`putChunk` has no
participant key. Do not feed individual participant streams into it: sequential
concatenation would corrupt time and attribution. B2/B6 must add an agreed
stream-key contract before Zoom per-participant audio can be supported. Mixed
capture plus the platform indicator is the explicitly limited fake-tested path.
M3/M4/M6 on a free Zoom account, native SDK packaging/version selection, the
owner's app feature and credentials, and B1 wiring remain outstanding. This
library is not enabled for live dispatch by this change.
