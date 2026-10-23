# meeting-bot

Axal's own meeting bot (D886, tracked in #2577). It joins a Zoom, Google Meet
or Microsoft Teams call as **"Eadwyn AI"**, posts the recording notice in the
meeting chat, and records the call's audio, the participant roster and the
active-speaker timeline. The Worker turns that into a session with named
speakers.

This folder is the bot **runtime**, the part that sits in the call. The
Worker's control plane (the routes, the `MeetingBotRun` Durable Object, the
callback, consent and metering) is B1's (#2579), under `cloudflare-worker/`.

**Not deployed yet.** D886 selects Cloudflare Containers. The owner kept the
TypeScript/Node core on 2026-10-22: Meet/Teams use Playwright for Node, and
Zoom uses a Python SDK sidecar behind the adapter. `Dockerfile` packages the
core, Chromium and Python; B8 builds/publishes it through its existing image
pipeline. Zoom's native bridge and Teams' packaged adapter are separate
integration work and fail closed in this entry. No live platform has been
verified by these fixture tests.

## What is here (B2, #2580)

The platform-independent core uses Node built-ins. Node 22.18+ runs the
TypeScript directly; the packaged browser adapter pins Playwright in this
folder's lockfile. No TypeScript compilation step is needed in the image.

| Folder | What it holds |
| --- | --- |
| `src/` | The core: the adapter contract, the lifecycle, audio chunks, events, the callback client, the log rule and the fake adapter. `src/adapters/` holds one adapter per platform (B3–B5). |
| `test/` | The core's tests, run by `npm run test:meeting-bot` (part of `test:drift`, so CI runs them on every PR), and their fake clock and stub callback (`_harness.ts`). `test/fixtures/` holds the adapters' page fixtures. |

| File | What it owns |
| --- | --- |
| `src/types.ts` | `MeetingAdapter`, the contract B3 (Meet), B4 (Zoom) and B5 (Teams) each implement: `join`, `admitted`, `sendChat`, `audio`, `roster`, `speakers`, `ended`, `leave`. Also `RunConfig` (what B1's Durable Object hands the runtime), the event and status shapes, `CallbackTransport` and D886's failure codes. |
| `src/constants.ts` | The bot's name, D872's audio format, ~30-second chunks, two minutes alone, the plan limits (30 minutes free, 2 hours paid), the admission wait, batching and retry. |
| `src/lifecycle.ts` | `runBot`: joining → waiting room → notice → recording → local completion, reported to B1 as processing; B6 alone reports done. |
| `src/wav.ts` | `encodeWav` (D872's canonical 44-byte header, byte for byte), `Chunker` (~30 s parts with `seq` and `start_ms`) and `toPcm16k` for browser audio. |
| `src/uploader.ts` | `ChunkUploader`: chunks sent as they complete, in order, retried with backoff, idempotent by `seq`; `drain` at the end. |
| `src/events.ts` | `EventBatcher`: roster changes turned into snapshots and explicit speaker/silence events. Internal `n` dedupes a retried batch; the callback owns the global wire `seq`. |
| `src/callback.ts` | `httpTransport`: B1's single signed `events` route, shared monotonic sequence, and same-origin one-use chunk PUT. Retries replay the same payload/seq before later events. Status, roster, speaker, chunk manifests and heartbeats share the queue. Errors contain a status only. |
| `src/log.ts` | The only way a log line is written: codes and counts, nothing else (`safeFields`). |
| `src/fakeAdapter.ts` | A scripted platform for the tests, and the reference implementation an adapter copies. |
| `src/index.ts` | The public library exports. |
| `src/runtime.ts` | One authenticated, idempotent run per container; start/stop acknowledge without waiting on callbacks. |
| `src/runtimeAdapters.ts` | Packaged adapter factory: Chromium/Meet now, explicit failure while Zoom native bridge and Teams wiring are absent. |
| `src/entry.ts` | Private HTTP entry, bounded command bodies, fixed logs, SIGTERM/SIGINT shutdown and a hard 28-second exit bound. |
| `Dockerfile`, `.dockerignore` | Linux image; its build runs the fake-adapter command smoke test before producing the runtime stage. |
| `package.json`, `package-lock.json` | Pinned browser dependency and isolated runtime install. |

| `src/adapters/teams.ts` | B5 (#2583): Microsoft Teams as a browser guest, over a `TeamsPage` driver (attributes only, so a caption's or a message's words never reach it). Launcher → pre-join (mic and camera off) → lobby, including Teams' "Suspected threats" bot approval; the notice in the meeting chat; the People pane as the roster; live captions' speaker names as the speaker timeline. A captcha, anonymous join turned off or a blocked bot is `platform_blocked`. |
| `src/adapters/teamsSelectors.ts` | B5: every Teams selector and the link rule (work or school, and Teams free; https only). **Provisional**, from published reports, until the live check records Teams' screens. |
| `notice.mjs` | B9's notice contract (#2587, #2590): `meetingBotNotice`, `MEETING_BOT_NAME`, the publication gate and the dispatch disclosure. See **The notice** below. |
| `src/adapters/meet.ts` | B3 (#2581): `MeetAdapter`, Google Meet. It joins as a guest with the microphone and camera off, waits in the waiting room, reads the participant panel and the active-speaker indicator, takes the tab's audio, and detects the end of the call and removal by the host (removal reads as the call ending). It takes a `MeetPage` (`src/adapters/meet/page.ts`), which a Playwright `Page` satisfies, so the core stays dependency-free. |
| `src/adapters/meet/selectors.ts` | Every Meet page hook, in one place. **UNVERIFIED:** written without access to Meet, and to be measured (#2581 step 1, D886 §8). |
| `src/adapters/meet/signals.ts` | The Meet adapter's pure rules: the page state from its hooks, the link check, the roster and the active speaker. |
| `src/adapters/meet/capture.ts` | The in-page audio capture: every remote WebRTC audio track mixed in Web Audio and handed to Node, from admission only. |
| `test/meet_*.test.ts`, `test/_meet_browser.ts` | The Meet tests. `meet_selectors` has one test per hook, so a changed hook fails one named test. The browser tests run Chromium on `test/fixtures/meet.html`, a **constructed** page (not recorded), and skip by name where there is no Chromium (`CHROMIUM_PATH`). |

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
   chat refuses the notice three times, the run fails as `notice_failed`
   and nothing is heard.
4. **Record.** Audio arrives from the adapter as 16 kHz mono 16-bit PCM. It
   is cut into ~30-second WAV chunks (960,044 bytes) and uploaded as each one
   completes. Roster and speaker events go in batches every 5 seconds, or at
   50.
5. **Leave.** The bot leaves when the call ends (`call_ended`), after two
   minutes as the only one there (`alone`), on Stop (`stopped`), or at the plan
   limit (`time_limit`). Then it sends the last partial chunk, retries anything
   unsent, flushes the events within 20 seconds and reports `processing` through B1, with local counts. Any remaining upload/event is `processing_failed`, never a complete recording.

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
  then each change. The core sends B1 snapshots of those changes, preserving the join clock through renames. It never reports the bot. `key` is the platform's id for
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
- **Node built-ins only** in the core. An adapter may need a browser (Playwright
  and Chromium for Meet and Teams) or the Zoom Meeting SDK. Those belong to
  the packaged adapter; its Playwright version is locked here and B8 builds the image.
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


## B1 contract and funded runtime (#2580 follow-up)

`httpTransport` takes the exact HTTPS `/api/meeting-bots/<uuid>/` Worker base
and the existing `MEETING_BOT_SECRET`. Every callback is one POST to `events`
with a global `seq`, signed HMAC-SHA256 over
`v1:<epoch milliseconds>:POST:<pathname>:<raw JSON>`. The headers are
`x-meeting-bot-timestamp` and `x-meeting-bot-signature`. No redirects are
followed. Chunk manifests carry `chunk_seq`, `size_bytes`, `start_ms`; only the
Worker's same-origin, exact-run/chunk `upload_path` may receive the WAV.
After a lost PUT response, the original manifest is replayed; only B1's
explicit `chunk_already_uploaded` acknowledgement counts as already stored.

B1 snapshots are `participants: [{id,name,joined_ms,left_ms}]`. Speaker changes
use `participant_id`, including `null` for silence. Names remain display
labels, never account identity. The adapter's legacy failure codes are mapped
to B1's published allowlist: `not_admitted` → `admission_refused`,
`meeting_ended` unchanged, notice/processing failures keep their matching
codes, and other platform/OBF/link failures use `runtime_failed`. SIGTERM is
locally `interrupted`, mapped to `failed/runtime_failed` in the current B1
protocol. B1/B8 recovery and part-number continuation across replacement
containers are not established by an in-memory client; they need a persisted
resume cursor and an agreed restart transition before being enabled.

`RunConfig` requires absolute `deadlineAt` and `budgetDeadlineAt`. Runtime
includes lobby and notice time; admission never resets the plan clock.
Heartbeats run every 15 seconds. An unrenewed lease stops capture and join
immediately, even during an unresponsive adapter call. Expired/malformed
replies never grant time. B1 must fund and return the next lease before the
current interval expires: funding only at its boundary cannot guarantee an
uninterrupted run across a network round trip. This is an integration gate,
not permission for the runtime to extend an unfunded interval.

## Container control

The container uses `MEETING_BOT_SECRET` (the existing shared secret),
`MEETING_BOT_CALLBACK_ORIGIN` (an HTTPS Worker origin) and optional `PORT`
(default 8080). B8 keeps this port private. POST `/start` and `/stop` use the
same signed-header format, signing their actual path. The five-minute command
window and 16 KiB body bound are enforced before a command is acted on.

`/start` takes B1's `{uid,platform,meeting_url,limit_minutes,deadline_at,
budget_deadline_at}`. An optional server-selected `venture_name` personalises
B9's shared notice; its generic authorised-venture fallback is otherwise used.
The runtime itself calls the gated `meetingBotNotice`, so an unpublished
notice refuses before constructing an adapter. There is no environment bypass.
A repeated identical start returns an acknowledgement and creates no second
adapter; a conflicting run/payload is refused. `/stop` takes `{uid}`.
Neither command waits for the callback of the same serialized supervisor.

`GET /healthz` is a content-free process check; `ready` states the notice
publication gate. Readiness is not a live platform verification. The image
runs as the `node` user. Chromium's sandbox is enabled; B8 must verify the
container host's namespace/seccomp compatibility, rather than disabling it.
Python is the sidecar host only: this image does not claim the Zoom SDK native
bridge has been packaged or measured. The switch and notice remain gated.

Run `npm ci --prefix meeting-bot`, then `npm run test:meeting-bot` from the
repository root. `CHROMIUM_PATH` can select an installed test browser for the
constructed Meet fixture. The new callback/recovery/container scenarios and
13 isolated source mutations use no real meetings, credentials or providers.

### Python sidecar continuation (B4)

`src/zoomSidecar.ts` implements `ZoomSdkBridge` over a private local pipe to
`zoom/sidecar.py`; `zoom/native.py` maps the SDK calls and callbacks.
See `zoom/README.md` for dependencies, protocol/privacy rules, tests, 32-to-16 kHz
conversion and outstanding B1/B2/B8 wiring. This replaces the unimplemented
native bridge boundary with code tested against synthetic SDK objects and a
real Python protocol peer. Linux SDK import and live meeting behavior remain
UNVERIFIED. The existing ZoomAdapter accepts it as its `sdk` dependency.
