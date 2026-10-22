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
| `src/` | The core: the adapter contract, the lifecycle, audio chunks, events, the callback client, the log rule and the fake adapter. `src/adapters/` holds one adapter per platform (B3–B5). |
| `test/` | The core's tests, run by `npm run test:meeting-bot` (part of `test:drift`, so CI runs them on every PR), and their fake clock and stub callback (`_harness.ts`). `test/fixtures/` holds the adapters' page fixtures. |

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
