# Eadwyn AI meeting bot: set up, check and switch off

Implementation runbook for D886 B9 (#2587), part of #2577.
Production deployment and real calls require the evidence in §4 and §7.
Post only counts, states and codes on the live-check issues and link them
from #1008. Keep meeting links, passcodes, participant names, roster
screenshots, transcripts, credentials and signed callbacks private.

## 1. Readiness and the rollout switch

`MEETING_BOT` is a Worker var, not a secret. `[vars]` and
`[env.production.vars]` ship `canary`; preview explicitly ships `off`.

- `off`: no new bot dispatch or scheduled start.
- `canary`: Super Admins only, hydrated through the existing elevation check.
- `on`: eligible founders, with the same consent, ownership and budget gates.

**Teams has its own switch** (D1451, #5297). `MEETING_BOT_TEAMS` is also a
var, not a secret, and ships `off` in `[vars]`, `[env.production.vars]` and
preview. Only the exact value `on` lets the bot take a Teams link; missing or
anything else is off. While it is off, `GET /api/founder/validate/meetings/bot`
reports `platforms.teams: false` (Zoom and Meet keep their own answers), and a
send with a Teams link answers `503 bot_unavailable` before any `meeting_bots`
row or token hold. It narrows `MEETING_BOT`, never widens it: with
`MEETING_BOT` `off` Teams is off too, and under `canary` it still reaches Super
Admins only. It stays `off` until the bot's Teams page driver (D1451 part 2)
and the live check in §4 pass; the owner turns it on in its own PR.

B1 (#2579) owns these checks on both immediate and scheduled runs. Changing
the var alone does not install the control plane or runtime. It also does
not prove that an already running bot has left; §6 requires Stop separately.
`canary` is the issue's configured default, not permission to skip readiness:
B1's supervisor checks the shared `MEETING_BOT_NOTICE_PUBLISHED` gate before
any paid hold or runtime call. With publication off, immediate dispatch can
return HTTP 202 with a failed run (`notice_unpublished`). Verify the run state
after HTTP acceptance. A scheduled dispatch waits as `queued` and checks the gate again
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
on **2026-10-22**, recorded by S1 on #2587. The owner merged that date into
the shared source for the restricted canary in #3624. B1 resolves the venture
through the authorized project. B2 imports `meetingBotNotice` and `MEETING_BOT_NAME` from
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

`MEETING_BOT_NOTICE_APPROVED_AT` drives both the runtime announcement and
`/privacy/interviews`. The date on `main` opens the source-level gate, makes
version 2 current and supplies its update date. The announcement links to
`/privacy/interviews?n=2`, and `?n=1` preserves the original wording for old
consent links. A missing or invalid date keeps version 2 unpublished. Verify
the deployed page, Worker and runtime against the same revision during §7.

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

The join path is the browser guest (D1451, owner Q1 = C). The Graph
Communications media bot (Azure Bot registration, tenant admin consent,
Windows media hosting) is not built; it is decided after a month of blocked
counts once Teams is on. The live check uses a separate Microsoft 365 trial or
developer tenant plus one Teams free link (Q2 = B), so anonymous join and
`BlockDetectedBots` can be toggled without touching a real tenant. Meeting
links are accepted on `teams.microsoft.com`, `teams.cloud.microsoft` (both
work or school) and `teams.live.com` (Teams free), `https` only. Until
`MEETING_BOT_TEAMS` is `on` (§1), the bot takes no Teams link.

## 4. Live check for each adapter before its rollout

The current owner check is Google Meet and Zoom under #3588. Teams remains
off and follows its separate owner check under #3709. For each platform,
use a consenting host and another participant in a dedicated test meeting.
Record the canary revision and runtime image in private evidence. Keep
`MEETING_BOT` at `canary` and verify that the Worker, privacy page and
runtime use the same approved notice source before testing. Record only
counts, states and codes on #3588 or #3709 and link those results from #1008.

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
   chosen retention boundary for the adapter under review. The merged purge
   explicitly selects `submitted_via = 'meeting_bot'` even without a provider
   ref. It uses the newest chunk and the member's setting (30 days by default,
   or keep-until-deleted), and waits while processing moves. Audio-only removal
   retains text and encrypted final participants; whole-session deletion
   removes transcript, staged text, bot row/final participants and encrypted
   roster/speaker events. Confirm a late upload cannot recreate removed audio.
8. Report per-platform pass/fail states and counts on its live-check issue.
   Mark unexercised checks **UNVERIFIED**. Expansion to `on` requires the
   owner to accept the notice, consent, retention, stop and metering evidence
   for the adapters being enabled.

Call audio defaults to 30 days under D877; the founder can choose a different
period or keep-until-deleted and can delete sooner. Retention removes audio,
not the transcript. Names and speaker timing belong to the session's cleanup.
Already accepted research findings may remain after the source is deleted.

## 4a. Staged diagnostic: where the bot stops (#3708)

Before changing more code, find the stage that fails. HQ › Platform ›
Meeting bots › **Diagnose Eadwyn AI** (`POST /api/admin/platform/meeting-bots/diagnose`,
Super Admin, TOTP and a recent step-up) takes the link of a Google Meet or
Zoom call **you host and are in**. It is not a meeting run: no session,
consent, AI tokens, notice or recording. It works with `MEETING_BOT = "off"`.

| # | Stage | Read by | Passes when | Typical failures |
|---|---|---|---|---|
| 1 | The site reaches the bot | Worker | `MEETING_BOT_CONTAINER` bound, `MEETING_BOT_SECRET` set, `APP_URL` https, the host's `/health` answers with its commit | `binding_missing`, `secret_missing`, `containers_disabled`, `binding_no_answer` |
| 2 | Google or Zoom setup | Worker | Meet: the OAuth client, your Google connection and its scopes, the Meet REST API answering. Zoom: the Meeting SDK app, your Zoom connection, an OBF mint for this meeting | `oauth_client_missing`, `not_connected`, `meet_api_disabled` (Google's `SERVICE_DISABLED`), `meet_api_scope_missing`, `zoom_waiting_for_host`, `zoom_obf_scope_missing` |
| 3 | The container starts | container host | the image boots and the runtime holds the signed command | `image_unavailable`, `container_start_failed`, `runtime_no_answer` (no boot in 20 s), `runtime_refused` (secrets differ) |
| 4 | The browser launches | container | Chromium starts (Meet only) | `launch_failed` |
| 5 | Egress | container | `meet.google.com` and `accounts.google.com` (Zoom: `zoom.us`, `api.zoom.us`) answer | `host_unreachable` |
| 6 | Join attempt | container | the bot asked to join (lobby) or is in | `signin_wall`, `cannot_join` ("You can't join this video call"), `page_unread`, `page_unsupported`, `join_click_unanswered` |
| 7 | Admission | container | you admit it within 3 minutes | `admission_timed_out`, `not_admitted` |
| 8 | Audio | container | frames arrive within 20 s and one probe chunk uploads | `no_frames`, `upload_failed` |
| 9 | Your last real run | Worker | its stored `failure_code` and D1368's `failure_detail` | `last_run_failed` |

- **Where it stops** is the first failing row among 1 and 3–8. Rows 2 and 9 are
  read beside it: Google's setup does not gate a guest join, and the consent
  screen's verification state is not readable through an API (check it in
  the Cloud console). The Workspace guest policy is answered by row 6.
- **Zoom** joins through the native SDK with a run's own credentials, so its
  container rows stop after egress; row 2's OBF mint and row 9's last Zoom
  run (with D1381's detail) say where Zoom fails.
- **Each failing row names its fix** (`DIAGNOSE_FIXES` in
  `services/meetingBotDiagnose.ts`). A code with none says so.
- **Privacy:** codes and counts only. The probe chunk is silence the length
  of the first frames; the Worker keeps its size. The screenshot of the
  stopping point is stored in `FILES` and shown only to the Super Admin who
  started the check; never post it, the link or anything it shows on #1008.
- **On #1008,** post the platform, the row it stops at and its code, and the
  owner step its fix names. A report that never arrives shows its rows as
  **Not recorded** (code `never_reported`) after ten minutes. That is a
  reporting gap, not a failed check: the container sends every stage again with
  each later report and once more after the check ends (D4857), so press Try
  again, and read the host's log for `diagnose_delivery_failed`.

## 4b. Teams deployment matrix and preflight (#5815, D5815)

Teams uses the same two bot hosts as Meet and Zoom. Nothing about its
deployment is Teams-only except the switch and, once #5812 lands, the page
driver inside the one image. `node scripts/check-meeting-bot-teams.mjs` checks
the matrix below offline, from `wrangler.toml`, `wrangler.meeting-bot.toml`,
`meeting-bot-deploy.yml`, the image's Dockerfile and lockfile manifest and
the host's container source. It prints `pass`/`FAIL` per row and never a
value, and it runs in `npm run test:guards` on every PR.

| Row | Production | Preview | Checked by |
|---|---|---|---|
| Site → host binding | `studioos` binds `MEETING_BOT_CONTAINER` to `studioos-meeting-bot` | `studioos-preview` binds it to `studioos-meeting-bot-preview` | `site_binds_its_own_bot_host` |
| Run state | `MEETING_BOT_RUN` (`MeetingBotRun`) on the site, never on the host | same | `site_has_run_state_object` |
| Chunk store | site's private `FILES` bucket, reached only through the one-use chunk PUT | the preview site's own `FILES` bucket | `site_has_private_files_bucket`, `environments_distinct`, `host_holds_no_member_oauth` |
| Callback origin | host `APP_URL` is exactly the production app origin | host `APP_URL` is the preview site's `workers.dev` origin | `host_callback_origin_is_this_site` |
| Signing context | no audience var; `MEETING_BOT_SECRET` set per host | `CF_BOT_AUDIENCE = "preview"`; its own `MEETING_BOT_SECRET` and `MEETING_BOT_PREVIEW_SECRET` | `host_signing_audience_scoped` (secrets: presence only, below) |
| Container | `MeetingBotContainer` class, its Durable Object and migration, image from `meeting-bot/Dockerfile` | same, separate application and namespace | `host_container_declared` |
| Image and browser | exact Playwright version from the lockfile; Chromium installed from it; one Node major | same image | `browser_pinned` |
| Readiness and egress | `standard-2`, egress on, `/healthz` ready and version before the signed command | same | `container_readiness_and_egress` |
| Revisions | `MEETING_BOT_VERSION` = the deployed commit; promoted only after the preview receipt | `MEETING_BOT_VERSION` = the same commit, deployed and verified first | `revision_stamped_and_preview_first` |
| Member OAuth | Microsoft, Google and Zoom member credentials stay on the site; the host binds no bucket, database or KV | same | `host_holds_no_member_oauth` |
| Switches | `MEETING_BOT = "canary"`, `MEETING_BOT_TEAMS = "off"` | `MEETING_BOT = "off"`, `MEETING_BOT_TEAMS = "off"` | `meeting_bot_switch_valid`, `teams_switch_valid`, `teams_never_wider_than_bot` |

A switch value outside its allowed exact set fails the check, because the
code reads anything but `on` as off and a typo would hide silently.

**Secrets, by presence only.** `MEETING_BOT_SECRET` must be set on the site
and on its host, with the same value per environment and different values
between environments. Check presence with `wrangler secret list` for each of
the four scripts; never print or post a value. Row 1 of §4a
(`secret_missing`, `runtime_refused`) is the live confirmation that a pair
matches. Rotation: set the new value on the host first, then on its site, in
one maintenance window with no run active (`runtime_refused` in between is
expected); then run §4a row 1 and the preview receipt again.

### Off, canary and the Teams pilot

- **Teams off** (`MEETING_BOT_TEAMS` anything but `on`): the capabilities
  read reports `teams.can_join_as_bot: false`, `GET /meetings/bot` reports
  `platforms.teams: false`, and a Teams send answers `503 bot_unavailable`
  before any `meeting_bots` row, charge or token hold. Meet and Zoom keep
  their own answers. `cloudflare-worker/test/meeting_bot_teams_d1451.test.ts`
  pins the availability and the refusal (no row, no reservation, no start, and
  a Meet send on the same session still queues); the capabilities row reads
  the same `platforms.teams` (`founder_validate_meetings.ts`).
- **Teams canary** (`MEETING_BOT = "canary"` and `MEETING_BOT_TEAMS = "on"`):
  Super Admins only, under every consent, notice and budget gate.
- **Positive testing** happens only in an isolated preview pilot or an owner
  pilot: the preview site and host with `MEETING_BOT` and `MEETING_BOT_TEAMS`
  set for that run, a Microsoft 365 developer tenant (§3), one run at a time,
  the plan's 30-minute limit, and the preview `FILES` bucket. Turning Teams on
  in production is the owner's separate rollout issue, not this runbook.
- **Version check** before and after any pilot: the host's `/health` and
  §4a row 1 report the commit; it must equal the site's deployed commit and
  the preview receipt's `revision`.
- **Failure signals:** §4a's stage codes, §5's failure codes, the preview
  receipt's `state`/`stage` (`[cf][preview][studioos-meeting-bot-preview]`,
  #5675) and production alerting (#5674). `platform_blocked` on Teams means
  the tenant's guest policy, `BlockDetectedBots` or a CAPTCHA.
- **Rollback to Teams off:** set `MEETING_BOT_TEAMS = "off"` in the
  environment's vars and ship through `DEPLOY.md`; press Stop on any Teams run
  (§6). Then send one Meet or Zoom run under canary to confirm another
  provider still works.

### Stage results

Record each environment's result here as states and codes only: environment,
site commit, host commit, image digest prefix, stage, `pass`/`fail`/`UNVERIFIED`.

| Environment | Stage | State | Evidence |
|---|---|---|---|
| both | offline matrix (`check-meeting-bot-teams.mjs`) | pass, 24 of 24 rows | this PR's CI |
| preview | signed preview receipt (#5675) | UNVERIFIED | waits on #5675's isolated callback |
| preview | Teams driver fixture in the packaged image | UNVERIFIED | waits on #5812 |
| preview | host → signed callback → upload → assembly, synthetic session | UNVERIFIED | waits on #5812 and #5675 |
| preview | corrupted, replayed and wrong-environment delivery refused or deduplicated | UNVERIFIED live; forged, stale and path-swapped events pinned offline by `meeting_bot_control_d886.test.ts`, replayed sequences by `meeting_bot_privacy_d886.test.ts` | waits on #5675 |
| production | preflight (bindings, secrets present, `/health` commit, Teams off) | UNVERIFIED | owner step after the preview receipt |

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

## 7. Owner acceptance and rollout

The owner merged the approved notice date for restricted canary testing in
#3624. Meet and Zoom acceptance and measured supplier cost remain open.

1. Run the owner check on Meet and Zoom in #3588 and link the results from
   #1008. Record admission, exactly one visible notice before capture, chat
   refusal, Stop/withdrawal, final upload and assembly, retention and deletion,
   and one settlement. Keep personal evidence private. Teams follows the
   same privacy checks separately under #3709 before its switch can be enabled.
2. Record D886 §7's measured supplier cost and image/resource measurements.
   Apply B1's measured bot-only cost and existing ×1.25 pricing after review.
   Confirm the target image, Worker binding, migrations 531/532 and runtime
   callback alignment on the chosen host. B8 documents deployment and shutdown.
3. Verify that the canary Worker, SPA and runtime image come from the same
   source revision. Confirm canonical `/privacy/interviews` and `?n=2` show
   version 2, `?n=1` preserves the original wording and links to version 2,
   and the runtime names the server-authorized venture. A wording change needs
   new owner approval in the shared notice module.
4. Before any rollout change, run the build, full drift suite and notice,
   control, assembly and runtime tests. The owner reviews the live evidence,
   merges the rollout PR and verifies the deployment. Keep preview `off`.
5. If a privacy or runtime check fails, follow §6 to switch dispatch off and
   verify Stop. If the owner withdraws publication, clear the shared approval
   setting in a reviewed rollback and rebuild the SPA and runtime. Preserve
   the older consent-version links.

Automated evidence: `cloudflare-worker/test/meeting_bot_privacy_d886.test.ts`
uses the real signed B2 callback client, B1 supervisor/routes, B6 processing and
D877 purge with SQLite/in-memory object storage. Fake adapters exercise the
same core for all three platforms; they prove no provider admission, SDK,
Chromium sandbox, live consent practice or measured price. Positive publication
fixtures modify the shared date only inside isolated modules. Production has
no bypass. Existing notice-render tests pin both publication states and legacy
links. The live results and measured price remain UNVERIFIED.
