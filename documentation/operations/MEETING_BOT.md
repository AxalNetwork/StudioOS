# Eadwyn AI meeting bot: set up, check and switch off

D886 B9, #2587; part of #2577. **Implementation runbook, verified against merged code 2026-10-23.**
This page describes the bot being built in B0–B10. It does not certify a
production deployment or a successful real call. Record only counts and
states in #1008: never a meeting link, passcode, participant name, screenshot
of a roster, transcript, credential or signed callback.

## 1. Readiness and the rollout switch

`MEETING_BOT` is a Worker var, not a secret. `[vars]` and
`[env.production.vars]` ship `canary`; preview explicitly ships `off`.

- `off`: no new bot dispatch or scheduled start.
- `canary`: Super Admins only, hydrated through the existing elevation check.
- `on`: eligible founders, with the same consent, ownership and budget gates.

B1 (#2579) owns these checks on both immediate and scheduled runs. Changing
the var alone does not install the control plane or runtime. It also does
not prove that an already running bot has left; §6 requires Stop separately.
`canary` is the issue's configured default, not permission to skip readiness:
B1's supervisor checks the shared `MEETING_BOT_NOTICE_PUBLISHED` gate before
any paid hold or runtime call. Immediate dispatch currently returns HTTP 202
with a failed run (`notice_unpublished`); HTTP acceptance is not proof that the
bot started. A scheduled dispatch waits as `queued` and checks the gate again
when due. The runtime independently calls gated `meetingBotNotice` and refuses
an unpublished or mismatched start notice before constructing an adapter.

D886 selects Cloudflare Containers and the TypeScript/Node runtime, with a
Python Zoom SDK sidecar. Before expanding access, confirm the cost measurement,
B1's dispatch/callback enforcement, B2's lifecycle and notice, all three
adapters, B6's assembly, B7's UI and B8's deployment on the deployed commit.
**UNVERIFIED until deployment/live evidence lands:** the installed image,
credentials actually installed, callback wiring, per-minute supplier cost,
free-account compatibility, and live admission/notice/speaker behavior.

Owner decisions from #2577: the name is **Eadwyn AI**; the maximum is
30 minutes on a free Axal plan and 2 hours on a paid plan. AI tokens cover
Cloudflare runtime, storage and transcription cost × 1.25. B0 measures the
rate; B1 reserves and settles it on the existing ledger. Unknown supplier
cost is not zero, and this document supplies no invented per-minute price.

## 2. Consent and the announcement

The founder records the interviewee's prior agreement using D757's existing
consent control before dispatch. B7 places `MeetingBotConsentNotice.jsx`
beside that control: **Eadwyn AI will join as a visible participant in the
call.** It does not select or supply consent itself. B1 refuses a dispatch
without recorded agreement, even if a client bypasses the control.

The owner approved the exact version-2 wording with **venture attribution**
on **2026-10-22**, recorded by S1 on #2587. Wording approval and publication
are separate: the publication setting remains null and the derived gate false.
B1 resolves that
venture through the authorized project, rather than accepting a display name
as authority. B2 imports `meetingBotNotice` and `MEETING_BOT_NAME` from
`meeting-bot/notice.mjs`. The function returns one plain-text announcement,
naming the venture, recording/transcription, participant display names and
who spoke when, how to stop and ask for deletion, and `/privacy/interviews`.
An absent venture label becomes “the venture that invited me”.

B2 posts it once on admission, before recording. Its once-only state must
survive duplicate callbacks and reconnects. Do not record silently when the
chat notice fails; confirm B2's refusal behavior in the live check. A chat
announcement does not itself establish agreement from everyone. If anyone
objects, the founder presses Stop or the host removes the bot. A new or
late participant must be informed and agreement checked before continuing.
Phone participants and hidden chat panels need the founder's spoken notice.

`/privacy/interviews` keeps its current version 1 unchanged. The bot text
is prepared as `MEETING_BOT_INTERVIEW_NOTICE`, candidate version 2, outside
the live version map; even `?n=2` cannot publish it. The runtime's gated
announcement also names version 2 and links with `?n=2`. After the checks above
pass, the owner publishes through the single PR in §7. That PR records the
actual approval date (`2026-10-22`, as recorded on #2587) in
`MEETING_BOT_NOTICE_APPROVED_AT`. Publication derives from that setting: a valid
date opens the runtime gate, adds version 2 to the page's map, makes it current
and supplies its update date together. A missing or invalid date keeps it
unpublished. Version 1 remains available for old chat-consent links. This
verification PR does not change the publication setting.

## 3. Owner setup by platform

### Zoom

The owner approved the additional Meeting SDK feature and OBF permission
on #2577. In the existing General app, open **Features → Embed** and enable
**Meeting SDK**. Keep its credentials in the deployed secret store, never
in source. Add **`user:read:token`** for the OBF flow and have the founder
reauthorize after B4 ships the matching scope contract. Updating only the
dashboard leaves Axal's strict callback scope check out of sync.

For meetings outside the app's account, confirm Zoom review/distribution
approval. The authorizing founder must already be in the meeting, and the
SDK participant cannot remain through that user's departure. B4 must meet
Zoom's current SDK minimum-version policy. The OBF FAQ cites 5.17.5 as the
historical minimum and improved OBF errors from 6.6.10; these are not a
recommendation to deploy an old SDK. Keep waiting-room and recording
permissions enabled as the host intends, then admit Eadwyn AI explicitly.

Sources read 2026-10-22: [Meeting SDK setup](https://developers.zoom.us/docs/meeting-sdk/get-credentials/),
[OBF authorization FAQ](https://developers.zoom.us/docs/meeting-sdk/obf-faq/),
[scope addition and reauthorization](https://developers.zoom.us/blog/transition-to-obf-token-meetingsdk-apps/).
Actual app approval, installed version and a successful free-account call
remain **UNVERIFIED** until B4/B0 record them. This is the visible bot path;
the RTMS eligibility study in D876 is a separate path.

### Google Meet

No additional Google API permission is expected for B3's visible guest bot.
This is an implementation expectation, **UNVERIFIED** until B0/B3 measure it,
not an assertion that every Workspace accepts guests. Use a call whose host
allows guest requests and admits Eadwyn AI. Host/organization restrictions
still apply. Do not request the closed-preview Meet Media API or add Drive
access just to enable this bot. D757's existing transcript-import permission
is separate and does not grant a bot admission.

### Microsoft Teams

No additional Microsoft API permission is expected for B5's visible guest
bot. That expectation is **UNVERIFIED** until B0/B5 measure it. The organizer
must permit the guest to request admission and admit Eadwyn AI from the
lobby. Tenant policies can refuse guest access. Do not grant a Graph
application recording permission as an assumed prerequisite for this path.

## 4. Live check: repeat on Zoom, Google Meet and Teams

Use a consenting host and another participant in a dedicated test meeting,
on a free provider account for each platform. These checks remain UNVERIFIED
until actually run. The public production gate stays false during preparation.
The owner must use an isolated release-candidate deployment/image with the
approved notice published there for the live checks: the normal unpublished
production build deliberately cannot join. Review that candidate change,
restrict access to Super Admins (`canary`), and keep its public release separate.
Use the same notice module and candidate privacy page; add no environment
bypass or alternate announcement. Record the candidate revision/image in the
private evidence, with only counts and states in #1008.

1. Confirm missing consent refuses dispatch and creates no runtime recording.
   Then record prior agreement; verify the visible-bot sentence before Send.
2. Send once. Confirm joining → waiting room/lobby → recording, and that the
   host sees **Eadwyn AI**. Admit it; a bot refused admission captures nothing.
3. Confirm the venture announcement appears once before recording. A replay
   or reconnect must not duplicate it. Refuse chat posting in a separate run:
   the runtime must report failure and leave without recording.
4. Run a three-minute conversation with both participants taking turns.
   Confirm roster join/leave counts and speaker changes; inspect content
   privately. Display labels are not verified identities. Add a late joiner,
   confirm their notice/agreement, then test an objection and Stop.
5. Confirm Stop makes the bot leave, and that leaving it alone for two
   minutes also ends the run. Test meeting end and the 30-minute/2-hour plan
   limits through B2's bounded test harness; do not infer them from a
   three-minute call.
6. Confirm chunks become one session, the participant count and speaker
   mapping are present, and the existing transcription/translation/summary
   and proposal paths are used. A Validate proposal still needs Accept.
   Check one settlement in AI tokens, including a duplicate completion.
7. Verify D877: audio-only deletion removes playback and leaves text;
   session deletion removes audio and transcript. Test both sides of the
   chosen retention boundary, including a Teams bot session. The merged purge
   explicitly selects `submitted_via = 'meeting_bot'` even without a provider
   ref. It uses the newest chunk and the member's setting (30 days by default,
   or keep-until-deleted), and waits while processing moves. Audio-only removal
   retains text and encrypted final participants; whole-session deletion
   removes transcript, staged text, bot row/final participants and encrypted
   roster/speaker events. Confirm a late upload cannot recreate removed audio.
8. Report per-platform pass/fail states and counts in #1008. Mark everything
   not exercised **UNVERIFIED**. Do not expand to `on` while a platform's
   notice, consent, retention, stop or metering check is unresolved.

Call audio defaults to 30 days under D877; the founder can choose a different
period or keep-until-deleted and can delete sooner. Retention removes audio,
not the transcript. Names and speaker timing belong to the session's cleanup.
Already accepted research findings may remain after the source is deleted.

## 5. Failure codes and operator response

The merged runtime's `FailureCode` in `meeting-bot/src/types.ts` has seven
codes. `callback.ts` maps them to B1's stored `failure_code`; the two names are
not always the same. Unknown codes are failures to investigate, never success.

- **`not_admitted` → `admission_refused`:** the bot was not admitted. Check the
  host's lobby/waiting room and dispatch a new run only after the old one ends.
- **`meeting_ended` → `meeting_ended`:** the meeting ended before the run could
  continue. Do not retry an ended meeting automatically.
- **`link_invalid` → `runtime_failed`:** the adapter could not use the link.
  Re-enter it privately; never paste it into an issue or log.
- **`platform_blocked` → `runtime_failed`:** check the host/tenant's guest,
  admission, chat and recording permissions. Do not blindly redispatch.
- **`obf_unavailable` → `runtime_failed` (Zoom):** confirm the founder granted
  the updated app/scope and is already in the meeting. Reconnect through Axal
  when needed; never collect a token manually.
- **`notice_failed` → `notice_failed`:** posting the announcement exhausted its
  retries. No capture may begin. Check chat permissions, then start a new run.
- **`processing_failed` → `processing_failed`:** an upload/event was unfinished,
  a drain expired, or processing failed. Do not call it a complete recording.
  Inspect counts/states; retain the saved parts under the normal retention rule.

Runtime leave reasons are `call_ended`, `alone`, `stopped`, `time_limit`,
`tokens` and `interrupted`. Normal completion reports `processing`, with
`chunks` and `chunks_failed: 0` after all uploads. B6 alone completes assembly.
`interrupted` currently maps to `failed/runtime_failed`; it is not an automatic
safe rejoin. Founder Stop retains B1's 30-second captured-audio drain; consent
withdrawal/access loss/deletion stop hard without that drain.

B1 may additionally store `notice_unpublished`, `runtime_unavailable`,
`schedule_missed`, `access_revoked`, `heartbeat_timeout`, `processing_timeout`,
`time_limit`, `tokens` or `session_deleted`. Respectively: finish publication
readiness; verify the runtime binding; create a fresh schedule; restore consent
and access with a new session where required; inspect heartbeat connectivity;
inspect processing progress; respect the plan; restore the token budget; or
leave the deleted session deleted. None authorizes a silent restart.

Dispatch/control HTTP refusals include:

- `consent_required` (409), `audio_removed` (409), `session_not_found` (404):
  obtain prior agreement, create a fresh session, or use the authorized session.
- `unsupported_link` / `bot_needs_audio` / `invalid_schedule` (400): correct the
  link, source, or seven-day scheduling window.
- `session_in_use` / `bot_already_running` (409): inspect the current run or use
  a fresh draft; do not start device recording on the bot's session.
- `bot_unavailable` / `bot_price_unavailable` / `bot_company_unavailable` (503):
  verify configuration, measured bot cost, or the server-selected company read.
- `ai_paused`, `budget_review`, `spend_limit`, `budget_user_day`,
  `budget_user_month` (402): use the returned budget sentence; do not bypass it.
- `bot_stop_pending` (503): Stop has not been acknowledged; retry/check the
  supervisor alarm and verify the host removed the bot if needed.

Callback protocol errors (`invalid_bot_event`, `invalid_bot_transition`,
`stale_bot_event`, `bot_not_started`, `bot_finished`, `bot_processing`,
`invalid_bot_chunk`, `invalid_bot_audio`, `invalid_upload`, `bot_not_recording`,
`bot_time_limit`, `too_large`) require B2/B8 contract diagnosis. Only
`chunk_already_uploaded` is the upload replay acknowledgement. Never retry an
arbitrary 409 as successful storage, or log a body/token to diagnose it.

## 6. Switch off and recover

1. Set `MEETING_BOT = "off"` in the target environment's vars block and ship
   through the normal reviewed deployment in `DEPLOY.md`. Recheck immediate
   dispatch and scheduled alarms: neither may start a bot while off.
2. Press Stop on each active run and verify its terminal state and absence
   from the meeting. If control-plane Stop is unavailable, the host removes
   Eadwyn AI; use B8's deployed runtime shutdown procedure when available.
   **UNVERIFIED:** provider-independent fleet shutdown until B8 lands it.
3. Preserve the private failure evidence needed for diagnosis. Settle/release
   existing holds through B1; do not alter balances or production D1 by hand.
   Existing sessions retain their consent, deletion and retention controls.
4. After a fix and the checks above, return to `canary` first. Expanding to
   `on` is the owner's rollout decision. This task performs no live rollout.

## 7. The owner's publication PR

This is a later, owner-merged PR. The wording approval on 2026-10-22 does not
clear the remaining gates. S28's automated verification keeps publication off.

1. Link the live check for **each** of Zoom, Meet and Teams on #1008 (counts
   and pass/fail states only). Include admission, exactly one visible notice
   before capture, chat refusal, Stop/withdrawal, final upload/assembly,
   retention/deletion, and one settlement. Keep personal evidence private.
   Resolve every failed/unexercised privacy gate before publication.
2. Record D886 §7's measured supplier cost and image/resource measurements;
   apply B1's measured **bot-only** cost and existing ×1.25 pricing. The canary
   ceiling is not the measured public price. Confirm the target image, Worker
   binding, migrations 531/532 and runtime command/callback secret alignment
   on the chosen host. B8 confirms its deployment and shutdown procedure.
3. Branch from current `main`. In the single publication PR set only the
   shared `meeting-bot/notice.mjs` approval setting to its actual recorded date,
   `2026-10-22`. The derived `MEETING_BOT_NOTICE_PUBLISHED` must become true;
   do not introduce a second flag or independently publish the page. Record
   the evidence and date in D886 and this runbook. If wording changes, obtain
   a new explicit wording approval first; do not reuse the old approval.
4. Keep `MEETING_BOT = "canary"` for the first production verification and
   preview `off`. Build the SPA **and** runtime image from that same published
   source. Verify canonical `/privacy/interviews` and `?n=2` show version 2,
   `?n=1` keeps the original wording and links to current version 2, and the
   runtime's start notice exactly matches the server-authorized venture.
5. Run root build/full drift and the B9 privacy, B1 control, B6 assembly, runtime
   and public-notice tests. All CI and independent review must be green. The
   owner merges and confirms the normal deploy plus a restricted live check;
   public access (`on`) is a separate owner rollout decision.
6. If a privacy or runtime check fails, keep or restore the shared setting to
   null in a reviewed rollback and execute §6 (`MEETING_BOT = "off"` plus
   verified Stop). Rebuild both artifacts. Removing publication alone is not
   proof that a bot already in a call has left. Keep old consent-version links.

Automated evidence: `cloudflare-worker/test/meeting_bot_privacy_d886.test.ts`
uses the real signed B2 callback client, B1 supervisor/routes, B6 processing and
D877 purge with SQLite/in-memory object storage. Fake adapters exercise the
same core for all three platforms; they prove no provider admission, SDK,
Chromium sandbox, live consent practice or measured price. Positive publication
fixtures modify the shared date only inside isolated modules. Production has
no bypass. Existing notice-render tests pin both publication states and legacy
links. The live results and measured price remain UNVERIFIED.
