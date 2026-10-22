# Zoom and Google Meet transcripts: switch on, check, roll back

The owner's runbook for interview calls on Zoom and Google Meet (D757, which
switches on D684's adapters). It covers creating and sharing the Zoom app,
switching on Meet transcript import, the live check, and what each refusal
from the Worker means. Secret and variable names only: no value belongs in
this file, in the repo, or in an issue.

A founder schedules a call from an interview in Validate › Record a session.
When the call ends and its transcript is ready, Axal imports it into that
interview, writes a draft summary and suggests findings for the Validate
modules. The founder accepts each one (D757 §2.7). Every source hands its
session to the same engine (`cloudflare-worker/src/services/channels/README.md`,
"The engine hand-off"); no Zoom or Meet code calls a model.

Agent sessions cannot open `marketplace.zoom.us` or `console.cloud.google.com`;
every step here is done from the owner's machine. The decisions behind each
step are in `documentation/architecture/decisions/D757.md` (§2.1, §2.12,
§2.15 and §3); the secrets and vars are listed in
`documentation/architecture/PRODUCTION.md` under "Interview channels".

## 1. Zoom, in order

Zoom's console labels below are as D757 records them. Six facts are
**unverified until the app exists** (D757 §3); each is marked, and each one
that turns out different is a one-line PR.

1. **The app.** marketplace.zoom.us → Develop → Build App → **General app**,
   **User-managed**, so each founder connects their own Zoom with no Zoom
   admin. Not Server-to-Server, not Admin-managed.
2. **OAuth.**
   - Redirect URL and OAuth allow list:
     `https://app.axal.vc/api/integrations/oauth/zoom/callback`. It is
     `OAUTH_CALLBACK_BASE_URL` (`wrangler.toml`) + `/api/integrations/oauth/zoom/callback`.
   - Copy the Client ID and Client Secret for step 5.
3. **Scopes, these eight.** The names below are as a General app lists them,
   confirmed on 2026-10-22.
   Six are the ones Axal uses:
   - `meeting:write:meeting`: create the call;
   - `meeting:delete:meeting`: delete it when the founder cancels;
   - `cloud_recording:read:list_recording_files`: list the recording files
     and download the transcript;
   - `meeting:read:meeting`: confirm a pasted meeting is the founder's;
   - `meeting:read:list_past_instances`: recover a call ended and restarted;
   - `user:read:user`: identify the connection on disconnect.

   Zoom also grants two that Axal accepts but never calls. On 2026-10-22 they
   stayed in the grant after they were removed from the Scopes page:
   - `cloud_recording:read:recording`: comes with the transcript event;
   - `zoomapp:inmeeting`: comes with a General app.

   Add none beyond these eight. The callback compares the grant with the registry
   (`cloudflare-worker/src/integrations/registry.ts`) and refuses a wider one.
4. **Events.** Features → Access → Event subscription:
   - Event notification endpoint: `https://axal.vc/api/channels/zoom/webhook`.
   - Events: `meeting.ended`, `recording.transcript_completed`,
     `recording.completed` (D870: a call with no transcript is transcribed
     from its audio-only recording) and `app_deauthorized`. No others:
     anything else is acknowledged and ignored.
   - For D870, the account's cloud recording must save an **audio-only
     file** (Settings → Recording → Cloud recording → "Audio only"). Without
     it, a call with no transcript has nothing to transcribe.
   - Copy the **Secret Token** for step 5. Do not press Validate yet.
5. **Secrets.** From the repository root, once each:

   ```sh
   npx wrangler secret put ZOOM_CLIENT_ID --config wrangler.toml --env production
   npx wrangler secret put ZOOM_CLIENT_SECRET --config wrangler.toml --env production
   npx wrangler secret put ZOOM_WEBHOOK_SECRET_TOKEN --config wrangler.toml --env production
   ```

   Zoom counts as set up only with all three. With any one missing, the Zoom
   card reads "Not set up here" and the webhook answers 503.
6. **Validate.** Back in Event subscription, press Validate. The Worker
   answers Zoom's `endpoint.url_validation` challenge **only when it is
   signed** with the Secret Token (*unverified*: that Zoom signs the
   challenge, D757 §3 item 2). If Validate fails with the secrets set, that
   item is wrong: say so on #1931 and S1 files the one-line change.
7. **Distribution.** An unpublished app can be authorized only by users in
   Axal's own Zoom account. Other founders need one of:
   - **Beta Test sharing**: up to 100 users, 4 weeks plus two 4-week
     extensions;
   - **Marketplace publication**: Zoom's review.

   Then set the wrangler **var** `ZOOM_APP_AUDIENCE` in both `[vars]` and
   `[env.production.vars]`, in one PR: `"beta"` once Beta Test sharing is
   approved, `"public"` once published. It ships `"own_account"` (also what
   absent or unknown values read as). The var sets only what the Zoom page
   says ("Zoom hasn't approved Axal for other Zoom accounts yet…", "Zoom
   beta: open to invited founders."); Zoom itself refuses the accounts the
   app is not shared with. *Unverified* (§3 item 3): whether a beta-shared app
   works through the ordinary authorize URL.
8. **Before Marketplace submission:** the deauthorization default (§2.15, #1008
   item 37). Imported transcripts stay as the founder's interview records
   after `app_deauthorized`, unless the owner and counsel decide otherwise.
   S1 records the answer in `D757.md`.
9. **The test account.** A Zoom account in Axal's own Zoom organisation, on
   Pro or higher, with cloud recording on and **Create audio transcript**
   turned on (Settings → Recording). Every founder needs the same plan and
   settings; the Zoom page says so.
10. **The live check**, §3 below.

## 2. Google Meet, in order

Meet uses the Google Calendar OAuth client founders already connect
(`GOOGLE_CAL_CLIENT_*`, else `GOOGLE_CLIENT_*`). Scheduling a Meet call works
today; only reading its transcript needs these steps.

1. **The scope.** Google Cloud Console → the Calendar OAuth client's project →
   OAuth consent screen → Data access: add
   `https://www.googleapis.com/auth/meetings.space.readonly`.
2. **Verification.** Submit the consent screen for Google's verification of
   that scope (*unverified*: its class, sensitive or restricted, D757 §3
   item 7). Until it passes, Google refuses the scope to members.
3. **The API.** APIs & Services → Library → **Google Meet REST API** →
   Enable, in the same project. Without it, an import is refused with
   `meet_api_disabled`.
4. **S01's flag.** Set the wrangler **var** `MEET_TRANSCRIPTS_ENABLED` to
   `"on"` in both `[vars]` and `[env.production.vars]`, in one PR, after
   steps 1 to 3. While it is `"off"`, members see no "Allow transcript import"
   button and `POST /api/calendar/google/meet-transcripts/connect` answers 503.
5. **Existing grants.** A member's Google grant made before the scope was
   added does not carry it. They press **Allow transcript import** once
   (Account › Connectors, or the Schedule panel); `GET /api/calendar/google/status`
   reads `meet_transcripts: "granted"` afterwards.
6. Each member needs a Google Workspace edition that includes Meet
   transcription, and someone in the call turns transcription on.

## 3. The live check (#1008 item 15)

Done by the owner on the test account (§1 step 9), on `https://app.axal.vc`.
Record the result on #1931 and #1008 as **counts and states only**: never a
name, an email, a meeting id or transcript text. If a step fails, S1 files it.

1. **Connect.** Account › Connectors › Zoom → Connect. Zoom's consent lists the
   six scopes; the page returns to Connected.
2. **Schedule.** From an interview in Validate › Record a session, schedule a
   Zoom call with cloud recording, confirming the interviewee agreed.
3. **A 3-minute call,** recorded to the cloud, with transcription on.
4. **The transcript is imported** into that interview's session. Zoom sends
   `recording.transcript_completed` minutes after the call ends; if none
   arrives, the daily sweep asks once, a day after the call.
5. **The draft summary**, with suggestions in each Validate module that the
   call touched.
6. **Accept one** suggestion, and see it in its module.
7. **Disconnect** Zoom in Account › Connectors. The page reads disconnected,
   and the imported transcript stays in the interview.

Then repeat steps 2 to 6 with Google Meet, once §2 is done.

## 4. What each refusal means

### Connecting

| Where | Answer | Meaning and fix |
| --- | --- | --- |
| `POST /api/integrations/connect` or `GET /api/integrations/oauth/zoom/start` | 503 `oauth_unconfigured`, "Zoom isn't set up on Axal yet, so it can't be connected. Nothing was sent to Zoom." | One of the three Zoom secrets is unset (§1 step 5). An admin's answer also lists the names. |
| Zoom connector routes | 404 | The viewer is not in a venture: Zoom is founder-facing (D757 §2.11, `audience_rule: 'venture'`). Not a fault. |
| The OAuth callback | `reason=scope_overreach`, "The provider granted permissions beyond those requested." | The Zoom app has a scope beyond the six (§1 step 3). Remove it in the Zoom console. |
| Zoom's consent page | Zoom's own refusal | The founder's account is outside the app's distribution (§1 step 7). |
| `POST /api/calendar/google/meet-transcripts/connect` | 503 `meet_transcripts_not_set_up`, "Importing Meet transcripts isn't set up on Axal yet." | `MEET_TRANSCRIPTS_ENABLED` is not `"on"` (§2 step 4). |
| The Google callback | `meet_scope_missing` | The member unticked the transcript permission, or Google withheld it before verification (§2 step 2). |

### The Zoom webhook (`POST /api/channels/zoom/webhook`)

| Answer | Meaning |
| --- | --- |
| 503 `zoom_unavailable` | `ZOOM_WEBHOOK_SECRET_TOKEN` is unset. Zoom's Validate fails. |
| 401 `signature_missing`, `signature_stale`, `signature_mismatch` | Not signed by Zoom, signed more than five minutes away from the Worker's clock, or signed with another token. A mismatch after a rotation means the secret and the Zoom console disagree. |
| 400 `malformed` | Not JSON, a challenge with no usable token, or a deauthorization with no user. |
| 500 `not_stored` | D1 refused the write; nothing was kept and Zoom sends the event again. |
| 200 `ignored` | Another app's deauthorization, an event not subscribed for, or a meeting Axal did not schedule. Every member's meetings reach this URL; only Axal's are kept. |

### Scheduling and importing

`POST /api/founder/validate/interviews/:id/meetings`:

- 409 `consent_required`: the founder did not confirm the interviewee agreed.
- 503 `provider_unavailable`, "Zoom calls are not available on Axal yet." or
  the Google Meet sentence: the provider's secrets are unset.

Attaching a Meet call from the founder's Calendar (D871, no `session_id`):

- 404 `meeting_not_in_calendar`: no event with that Meet code or id is on the
  founder's primary calendar, or it has no Meet conference.
- 409 `meeting_not_hosted`: another account organises it; its transcript is
  in that account's Drive.
- 409 `meeting_no_time` (an all-day event), `meeting_expired` (it ended more
  than 30 days ago, past Meet's retention), `meeting_link_reused`.
- The live check (§3) should note what Meet names an external participant:
  D871 §2 leaves it UNVERIFIED.

A call that cannot be imported keeps its reason on the call, in one of the
sentences of `MEETING_ERRORS` (`cloudflare-worker/src/services/channels/meetings.ts`).
The ones the owner is likely to see during setup:

| Code | Meaning and fix |
| --- | --- |
| `zoom_not_connected` | The founder disconnected, or Zoom sent `app_deauthorized`. Reconnect. |
| `zoom_reconnect` | Zoom refused Axal's token (revoked, or the app's credentials changed). Reconnect. |
| `zoom_no_transcript` | No cloud transcript: the plan, cloud recording or "Create audio transcript" (§1 step 9). |
| `zoom_fetch_failed` | Zoom refused the recording list. *Unverified* (§3): whether downloading the transcript needs a scope beyond listing. |
| `stt_consent_missing` | D870: no transcript, and the interview has no consent recorded, so the audio was not fetched. Record consent on the interview, then Retry. |
| `stt_budget`, `stt_paused` | D870: the member's AI tokens ran out, or their AI is paused. The audio chunks are kept; Retry after a top-up transcribes only what is left. |
| `zoom_audio_unreadable`, `zoom_audio_too_large` | D870: the audio-only file is not an AAC M4A, or is over 80 MB. |
| `meet_transcripts_unavailable` | The member's grant lacks `meetings.space.readonly` (§2 step 5). |
| `meet_api_disabled` | The Meet REST API is off in the Cloud project (§2 step 3). |
| `meet_no_transcript` | Nobody turned transcription on, or the Workspace edition lacks it. |
| `meet_no_transcript_recording` | As above, but the call was recorded. The founder downloads it from Drive (`GET …/meetings/:refUid/recording` gives the link) and uploads it; Axal holds no Drive scope (D871). |

## 5. Rollback

- **Zoom:** delete one of the three secrets
  (`npx wrangler secret delete ZOOM_WEBHOOK_SECRET_TOKEN --config wrangler.toml --env production`).
  Connecting answers 503, the webhook answers 503, and scheduling answers 503;
  transcripts already imported stay. To stop new founders only, deactivate the
  app in the Zoom console.
- **Meet:** set `MEET_TRANSCRIPTS_ENABLED` back to `"off"` in both vars blocks.
  Grants already made keep the scope; to stop imports too, disable the Meet
  REST API (§2 step 3).

## 6. Call audio: the other paths, retention and deletion (D872, D870, D877)

A call reaches Record a Session as text by one of three paths. Its audio, when
Axal holds any, is kept apart from its text.

| Path | On `main` | What Axal stores |
| --- | --- | --- |
| The provider's transcript: Zoom's VTT, Meet's entries (§1, §2) | Yes (D684, D757) | Text only. No audio. |
| An uploaded recording (D872, #2519), with the founder's attestation that everyone recorded agreed | The routes and `frontend/src/lib/recordingUpload.js`, yes; the screen is M9 (#2525) | The browser's 16 kHz WAV parts as R2 chunks, then the text from Workers AI speech-to-text, charged in AI tokens. |
| Zoom with no transcript: the call's audio-only recording, transcribed by Workers AI (M1, D870, #2517) | Yes. It needs `recording.completed` and the account's audio-only file (§1 step 4). | The recording's audio as R2 chunks under the call's session, then the text, charged in AI tokens. |

**Retention (D877, #2524, migration 530).** A call's audio, from an upload or
from a Zoom recording, is kept for its founder's retention, then removed by
the daily cron (03:50 UTC, beside the channel purge). The text stays, and the
session records "audio removed" with the reason.
- The default is 30 days (owner question 1 on #2524, answer A). Changing the
  default is one constant, `DEFAULT_CALL_AUDIO_RETENTION_DAYS` in
  `cloudflare-worker/src/services/callAudioRetention.ts`, by PR.
- A founder chooses their own: `PUT /api/founder/validate/sessions/audio-retention`
  with 1 to 3650 days, or `null` to keep audio until they delete it.
- Age counts from the newest audio chunk's arrival. A transcription still
  running keeps its audio until the next day's run.
- The in-person recorder's audio is not a call; it is kept until deleted.

**Deletion.** Both are the founder's, and immediate for the R2 objects.
- **The audio only:** `DELETE /api/founder/validate/sessions/:id/audio`. The
  transcript, summary and accepted items stay.
- **The whole session:** `DELETE /api/founder/validate/sessions/:id` removes the
  audio and the text. An item the founder accepted stays, as their decision,
  and its record line reads "Source deleted".
- Nothing is restored from a backup into a deleted session or a removed
  recording.

**Reading it in production: aggregates only.** From the repository root:

```sh
npx wrangler d1 execute studioos-db --remote --env production --command \
  "SELECT audio_removed_reason AS reason, COUNT(*) AS sessions FROM interview_sessions
    WHERE audio_removed_at >= datetime('now', '-7 days') GROUP BY reason"
```

The Worker log prints one line a day when the purge removed anything:
`[cron] call audio purge sessions=<n> objects=<n>`.

## 7. The switch-on order

Each step is the owner's, in this order; each later step depends on the one
before.

1. **Zoom, own account** (§1 steps 1 to 6, 9 and 10). `ZOOM_APP_AUDIENCE`
   stays `"own_account"`: only users in Axal's own Zoom account can connect.
2. **The live check** (§3) on the test account; an upload (§6) once M9's screen ships.
3. **Zoom, beta** (§1 step 7): Beta Test sharing, then `ZOOM_APP_AUDIENCE =
   "beta"` by PR in both vars blocks.
4. **Google Meet** (§2): the scope, Google's verification, the Meet REST API,
   then `MEET_TRANSCRIPTS_ENABLED = "on"` by PR.
5. **Zoom audio** (M1, D870): `recording.completed` in the Zoom app and the
   account's audio-only file (§1 step 4). Without them a call with no
   transcript ends at `zoom_no_transcript`.
6. **Zoom, public** (§1 steps 7 and 8): the deauthorization default recorded,
   Marketplace publication, then `ZOOM_APP_AUDIENCE = "public"` by PR.

`cloudflare-worker/test/meeting_readiness_d877.test.ts` checks the gates
these steps rely on: the webhook signature, tenancy from the ref, scope
overreach, consent and notice, metering and the purge. Each gate is
mutation-checked. It certifies the code, not the Zoom app or Google's
verification.
