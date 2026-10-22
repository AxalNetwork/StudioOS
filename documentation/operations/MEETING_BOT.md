# Eadwyn AI meeting bot: set up, check and switch off

D886 B9, #2587; part of #2577. **Implementation runbook, 2026-10-22.**
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
B1 must also refuse dispatch and scheduled starts while the shared
`MEETING_BOT_NOTICE_PUBLISHED` gate is false. B2's `meetingBotNotice` refuses
to supply an announcement in that state, before any audio is captured.

Before expanding access, confirm B0's runtime choice and cost measurement,
B1's dispatch/callback enforcement, B2's lifecycle and notice, all three
adapters, B6's assembly, B7's UI and B8's deployment on the deployed commit.
**UNVERIFIED until their evidence lands:** runtime host and image,
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

The owner chose **venture attribution** in the S28 session. B1 resolves that
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
pass and the notice is approved, set its actual `MEETING_BOT_NOTICE_APPROVED_AT`
date. Publication derives from that setting: a valid date opens the runtime
gate, adds version 2 to the page's map, makes it current and supplies its
update date together. A missing or invalid date keeps it unpublished.
Version 1 remains available for old chat-consent links. The candidate has no
invented approval date or contact address. This change creates no
owner/counsel publication record.

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
on a free provider account for each platform. Keep access at `canary`.

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
   chosen retention boundary, including a Teams bot session. The existing
   purge recognizes uploads and `interview_channel_refs`; B1/B6 must make
   every bot session eligible or extend that selector. A recording stored
   under a session alone is insufficient. Verify roster/speaker cleanup on
   whole-session deletion too.
8. Report per-platform pass/fail states and counts in #1008. Mark everything
   not exercised **UNVERIFIED**. Do not expand to `on` while a platform's
   notice, consent, retention, stop or metering check is unresolved.

Call audio defaults to 30 days under D877; the founder can choose a different
period or keep-until-deleted and can delete sooner. Retention removes audio,
not the transcript. Names and speaker timing belong to the session's cleanup.
Already accepted research findings may remain after the source is deleted.

## 5. Failure codes and operator response

These are all five runtime codes in B2's filed contract (#2580); a final
implementation may add codes. Reconcile this catalogue with B2 before launch,
rather than treating an unknown code as success.

- **`not_admitted`**: the bot was not admitted. Ask the host to check the
  lobby/waiting room, then try a new dispatch after the prior run has ended.
- **`meeting_ended`**: the meeting ended before the run could continue.
  Check the run state; do not retry an ended meeting automatically.
- **`link_invalid`**: the adapter could not use the link. The founder checks
  and re-enters it privately; never paste it into a support issue or log.
- **`platform_blocked`**: the platform refused the bot. Check host/tenant
  guest, admission, chat and recording permissions with the adapter's evidence.
  Repeated blind dispatches are not a fix.
- **`obf_unavailable`** (Zoom): required delegated authorization was not
  available. Confirm the founder authorized the updated app, its required
  scope was granted, and that founder is already in the meeting. Reconnect
  through Axal if needed; never collect their token manually.

B1's separate dispatch refusals are **`consent_required`** (409: record
agreement first), **`unsupported_link`** (400: use an admitted provider link),
**`bot_already_running`** (409: inspect or stop the existing run), and **402**
when the AI token hold cannot cover the plan limit. The 402 code is not yet
specified by the filed contract: use B1's returned sentence and actual code
once implemented. No new failure-code names are invented here.

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
