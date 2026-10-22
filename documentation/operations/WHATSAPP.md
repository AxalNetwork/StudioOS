# WhatsApp: switch on, check, roll back

The owner's runbook for WhatsApp Business (D754, which amends D684). It is
everything needed to switch WhatsApp on, check it on a real phone, and roll it
back. Secret and variable names only: no value belongs in this file, in the
repo, or in an issue.

There are two ways in, through one Meta app and one webhook
(`https://axal.vc/api/channels/whatsapp/webhook`):

- **Way A, your business number.** A member connects their own WhatsApp
  Business number through Meta's Embedded Signup popup, in coexistence mode, so
  the WhatsApp Business app keeps working on their phone. Customers' chats wait
  in the member's inbox, and the member adds one to an interview.
- **Way B, Send to Axal.** Axal runs one number of its own. A member links their
  WhatsApp to their account and forwards recordings of interviews they held.
  Each recording waits until the member confirms everyone agreed; importing it
  as a draft interview is the rest of #1939, not on `main` yet. Way B exists
  only if the owner says yes (step 0a) and its three secrets and the
  `WHATSAPP_AXAL_DISPLAY_NUMBER` var are all set.

**What is on `main`.** Most of what this runbook describes has merged. What
still waits is marked here and where it is used:

| Part | Lands with |
| --- | --- |
| `WHATSAPP_CHANNEL` read by the Worker (`off` / `canary` / `on`), 7-day voice-note deadline, split calling reasons | #1950 (D754 `w1_switch_on`, #1892), **on `main`** since 2026-10-19 |
| Consent in the chat, the member's word, and the gate | #1954 (D754 `w2_consent`, #1893), **on `main`** |
| Consent in Record a Session; the WhatsApp connector page | #2001 (#1980) and #1993 (#1959), **on `main`** |
| Consented voice notes stored as recorder audio in the chat's session, transcribed there, then the engine; **Open recording** plays them | #2063 (#1935, D754 W3), **on `main`** |
| Way B: linking Axal's number, forwarded recordings waiting for consent, **Agreed beforehand** in Axal, and a Super Admin's unset settings | #2005 (#1937), #2006 (#1938), #2052 and #2056 (#1939 parts 1 and 2), **on `main`** |
| Way B: a consented recording imported as a draft interview, and the "Saved" reply | The rest of #1939, **not on `main`**: a consented capture waits, and is purged 7 days after its first file |
| Unsigned webhook refused, checked on every smoke run | #1999 (`scripts/check-spa-live.mjs`), **on `main`** |

#1950 and #1954 are on `main`, so the WhatsApp secrets can be set:
`WHATSAPP_CHANNEL` (shipped `canary`) keeps WhatsApp from members until the
live check (§3) passes, and nothing from a chat is kept before the
interviewee's consent.

## 1. Owner steps, in order

Meta requirements and dashboard labels below are **UNVERIFIED** until read
on Meta's current official pages (D861). The owner completes the dashboard
steps and records approval privately; do not paste app/account identifiers or
credentials into an issue. See §7 before any general-availability PR.

0. **Three decisions**, answered on #1008 item 16 or to S1:
   - a. Way B, Send to Axal: yes or no. Axal's account pays Meta for that
     number's replies past 1,000 a month. Today that is one consent question per
     forwarded batch, plus one reply to each `LINK` and `STOP`; the "Saved"
     reply comes with the rest of #1939.
   - b. Consent before anything from a chat is kept: D754 says yes. Say if you
     disagree.
   - c. WhatsApp Calling: D754 says not now (D754 §3). Say "go" to have S1 check
     Meta's Coexistence and Call recording pages and file the calls tasks.
1. **Business verification.** business.facebook.com → Settings → Security
   Center: verify Axal's legal entity.
2. **The Meta app.** developers.facebook.com → My Apps → Create app, type
   Business, linked to that portfolio.
   - Add the products WhatsApp and Facebook Login for Business.
   - App settings → Basic: icon, privacy policy URL, terms URL, data deletion
     instructions URL, category.
   - App Domains: `axal.vc` and `app.axal.vc`.
3. **Tech Provider.** App Dashboard → WhatsApp → onboarding.
   - Become a Tech Provider and complete access verification.
   - Submit app review for advanced access to `whatsapp_business_messaging`
     and `whatsapp_business_management`. Meta asks for two screen recordings
     (a message sent from the app and received in WhatsApp, and a template
     being created); use the App Dashboard's test number. Axal itself uses no
     template.
   - Switch the app to Live.
4. **Embedded Signup configuration.** Facebook Login for Business →
   Configurations → Create → WhatsApp Embedded Signup.
   - Choose "connect an existing WhatsApp Business app" (coexistence) if it is
     offered there.
   - Allowed SDK domains: `https://axal.vc` and `https://app.axal.vc`.
   - Keep the configuration id.
   - Read Meta's current Embedded Signup implementation page and reconcile the
     required popup version and `extras` with W1 (#2501). Version/deprecation
     claims in the earlier runbook were not verified here.
5. **Worker secrets, before the webhook.** Meta checks the verify token when the
   webhook is saved, and without the secrets the Worker answers 503. Run
   this from the repository root for each:
   `npx wrangler secret put <NAME> --config wrangler.toml --env production`.
   - `WHATSAPP_APP_ID`;
   - `WHATSAPP_APP_SECRET` (App settings → Basic → App secret);
   - `WHATSAPP_VERIFY_TOKEN` (a long random string you make up);
   - `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` (step 4).

   They are not in HQ → Integration keys. A secret needs no deploy.
6. **The webhook.** App Dashboard → WhatsApp → Configuration.
   - Callback URL: `https://axal.vc/api/channels/whatsapp/webhook`.
   - Verify token: the same string as `WHATSAPP_VERIFY_TOKEN`.
   - Subscribe `messages` and `smb_message_echoes` only. **Not `calls`**, and
     no template fields.
7. **Rollout.** `WHATSAPP_CHANNEL` ships `"canary"` in `[vars]` and
   `[env.production.vars]` of `wrangler.toml`. In canary only Super Admins can
   connect or link; members keep seeing "Not available yet" for way A. Once
   Axal's number is set (step 8), members in canary also see way B's **Link
   your WhatsApp**, and pressing it answers "This channel is not available on
   Axal yet." Nothing to do yet.
8. **Axal's own number (only if 0a is yes).**
   - In the portfolio, create Axal's own WhatsApp Business Account.
   - Add a phone number that is on no WhatsApp app, and get its display name
     approved.
   - Register it with a 6-digit two-step PIN. Keep the PIN yourself; it is
     never stored.
   - Business Settings → Users → System users: add an Admin system user, assign
     it the app and Axal's WhatsApp Business Account with full control, and
     generate a token that never expires, with `whatsapp_business_messaging`
     and `whatsapp_business_management`.
   - Make sure the app is subscribed to Axal's WhatsApp Business Account. It
     uses the same webhook.
   - Add a payment method to that account.
   - Set the secrets `WHATSAPP_AXAL_ACCESS_TOKEN`,
     `WHATSAPP_AXAL_PHONE_NUMBER_ID` and `WHATSAPP_AXAL_WABA_ID`.
   - Ask S1 to set the public var `WHATSAPP_AXAL_DISPLAY_NUMBER` (E.164) in both
     vars blocks.
9. **Privacy policy and data deletion page.** Say that WhatsApp chats a member
   adds to an interview, and voice notes and forwarded recordings once consent
   is given, are stored and transcribed (a forwarded recording's audio once
   the rest of #1939 lands); that they are kept until the member
   deletes them; and how to delete them. Meta's app settings need the data
   deletion URL.
10. **The live check**, in canary, on a real device (§3).
11. **Billing and tier check**, on Meta's current official pages and the
    app's dashboard: record the current message categories, prices, tier
    definitions and account/number limits. The earlier 1,000-message allowance
    is UNVERIFIED; do not use it for a cost estimate or a rollout decision.
    Confirm who is billed for member numbers and for Axal's own number.

## 2. The automatic check

Every smoke run of `scripts/check-spa-live.mjs` (after each deploy, and on its
schedule) POSTs an unsigned body to `/api/channels/whatsapp/webhook` on each
host. It sends nothing to Meta and needs no secret.

| Answer | Meaning | Smoke |
| --- | --- | --- |
| 401 or 403 | The signature check refused it: the secrets are set | PASS |
| 503 `not_configured` | No WhatsApp secrets yet | PASS |
| any 2xx | **The webhook accepted an unsigned body** | **FAIL** |
| anything else, or unreachable | Not this check's business | PASS, logged |

By hand, after step 5, the same three answers can be checked from any machine:

- `GET /api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`
  answers 403 (503 before the secrets).
- An unsigned `POST` answers 401 (503 before the secrets).
- Meta's own "Verify and save" in step 6 succeeds, which is the right token
  answering 200 with the challenge.

## 3. The live check on a real device

Do it in canary, signed in as a Super Admin. Use two phones: phone 1 holds the
test business number, phone 2 plays the interviewee.

**Way A, your business number.**

1. Account → Connectors → WhatsApp: press **Connect WhatsApp Business**, then
   **Continue with Facebook** ("Meta’s window opens next. Log in with the
   Facebook account that manages your business."). Meta's popup opens; sign in
   and pick the test number. See: "WhatsApp Business is connected.", the
   verified business name (or `•••• 1234` when Meta gives none), and
   **Connected**.
2. From phone 2, send the test number a text and a voice note. See: "1
   conversation waiting · Open the inbox", and in the inbox the voice note as
   "Voice note, transcribed when you add this chat to an interview".
3. Record a Session → Text chat → WhatsApp: pick that chat, name the
   interviewee, and under "Recording consent" choose **Ask <Name> in
   WhatsApp** (offered only if the contact wrote in the last 24 hours). Press
   **Import the chat**. See on phone 2: the consent notice with **Yes, I agree**
   and **No, thanks**. See in Axal: "Waiting for <Name> to agree" on the
   session page, and "Waiting for consent" in Customer research.
4. On phone 2, tap **Yes, I agree**. See in Axal: "Agreed in WhatsApp at
   <time>", and the text and the voice note's transcript on the session page.
   On the interview's page, **Open recording** plays the voice note.
5. From phone 2, send `STOP`. Send another text. See: "<Name> withdrew
   consent", nothing new in the session, and **Discard this chat's recording**.
   Press it ("This deletes the session and its transcript."), then **Discard**.
6. Press **Disconnect**, then **Disconnect** in the confirmation ("New WhatsApp
   chats stop arriving, and conversations still waiting in your inbox are
   deleted. Anything you already put in an interview stays there."). See: the
   number gone.

**Way B, Send to Axal** (once Axal's number is set, step 8).

1. Account → Connectors → WhatsApp: press **Link your WhatsApp**. See: "Send
   this code to Axal on WhatsApp: `LINK <code>`", **Open WhatsApp**, **I’ve
   sent it. Check again** and "Expires in 10 minutes."
2. Press **Open WhatsApp** on your phone and send the pre-filled `LINK <code>`
   to Axal's number. See in WhatsApp: "Confirm in Axal to finish linking this
   WhatsApp." Back in Axal, press **I’ve sent it. Check again** (or return to
   the tab): "Is •••• 1234 your number?" Press **Confirm**. See: "Your WhatsApp
   is linked."
3. Forward a voice note to Axal's number. See in WhatsApp, once per batch (up
   to 20 files within 30 minutes): "Before Axal transcribes this: did everyone
   in the recording agree to be recorded and transcribed before it started?",
   with **Yes, out loud**, **Yes, in writing** and **No**. In Axal, the
   recording is listed as "Waiting for consent" with **Agreed beforehand**.
   Tap **Yes, out loud** in WhatsApp.
4. *With the rest of #1939 only:* "Saved to Axal" with a link, and the draft in
   Customer research as "Imported from WhatsApp", with its transcript. Until
   then nothing more is sent and the consented recording waits.
5. Press **Unlink**. See: "Your WhatsApp is unlinked. Axal no longer saves what
   it sends."

If every step shows what it should, ask S1 to set `WHATSAPP_CHANNEL = "on"` in
both vars blocks of `wrangler.toml`, in one PR. It ships on the next deploy.

## 4. What a member sees, state by state (D754 §11)

| State | Members see | Super Admins also see |
| --- | --- | --- |
| Secrets unset | **Not available yet.** "Axal has not switched this on yet. There is nothing for you to set up until it does." | The missing secret names |
| `WHATSAPP_CHANNEL` is `canary` | Not available yet | "Only Super Admins can connect while WhatsApp is in canary." Then every state below |
| `WHATSAPP_CHANNEL` is `off`, with a connection | "Axal has switched this off for now. Your connection is kept, but nothing new arrives until it is back." | — |
| `WHATSAPP_CHANNEL` is `off`, no connection | Not available yet | — |
| Sign-up ids malformed | "Not set up yet: Meta's sign-up is not configured on Axal." | — |
| A, not connected | **Your business number**, with **Connect WhatsApp Business** | — |
| A, connected | The business name or `•••• 1234`, **Connected**, "N conversations waiting · Open the inbox" (when any wait), **Test the connection**, **Disconnect** | — |
| A, needs attention | "WhatsApp stopped accepting Axal’s access. Connect again." The page draws it, but the Worker does not yet mark a WhatsApp connection revoked, so no live data reaches it. | — |
| B, Axal's number unset | The section is hidden | "Send to Axal is off on this deployment. These settings are not set:", then only the unset names; with all four set and WhatsApp off, "Send to Axal is off on this deployment." |
| B, not linked | **Send recordings from your WhatsApp**, with **Link your WhatsApp** | — |
| B, linking | "Send this code to Axal on WhatsApp: `LINK <code>`", **Open WhatsApp**, "Expires in 10 minutes.", then "Is •••• 1234 your number?" **Confirm** | — |
| B, linked | `•••• 1234`, "Last recording <date>." or "No recording sent yet." (the date moves on any message from the number), then **Unlink** | — |
| B, a recording waiting | Each waiting capture as "N recordings, <date>" with "Waiting for consent" and **Agreed beforehand** (#2056) | — |
| Calls line | "Calls: not yet. WhatsApp calls do not reach Axal; record a call with the in-app recorder instead." With a number connected, its own "Calls: not yet, because …" replaces the first sentence. | — |

On the session page a chat reads "Waiting for <Name> to agree", "Agreed in
WhatsApp at <time>", "<Name> declined. Nothing from this chat was kept." or
"<Name> withdrew consent". In Customer research it reads "Waiting for consent",
"Declined in WhatsApp", or the method "Agreed in the chat", and a WhatsApp
session is "Imported from WhatsApp".

## 5. Rolling back

- **Switch it off for members:** set `WHATSAPP_CHANNEL = "off"` in both vars
  blocks and deploy (`documentation/operations/DEPLOY.md`). Connections are
  kept; members with a connection read "Axal has switched this off for
  now…", the rest "Not available yet"; the webhook still
  verifies signatures and answers Meta, but stores nothing, so Meta does not
  retry for 7 days. Set it back to `"canary"` or `"on"` to resume. Messages
  sent while it was off are not recovered.
- **Back to Super Admins only:** set it to `"canary"` and deploy.
- **Stop the webhook entirely:** in App Dashboard → WhatsApp → Configuration,
  unsubscribe the fields. Deleting `WHATSAPP_APP_SECRET` also works: the
  webhook's POST then answers 503 and Meta retries for up to 7 days. Delete it
  with the other three, because it hides WhatsApp from Super Admins too, and
  deleting only another secret hides WhatsApp in Axal while the webhook keeps
  storing.
- **Way B only:** delete one of `WHATSAPP_AXAL_ACCESS_TOKEN`,
  `WHATSAPP_AXAL_PHONE_NUMBER_ID` or `WHATSAPP_AXAL_WABA_ID` with
  `npx wrangler secret delete <NAME> --config wrangler.toml --env production`. The section hides and
  way B's webhook branch ignores everything; way A keeps working.

No rollback deletes what members already added to interviews: consented chats,
audio and transcripts stay until the member deletes them.

## 6. Things that catch people out

They are also rows in `documentation/architecture/GOTCHAS.md`.

- WhatsApp media ids can be fetched for **7 days**. A voice note whose chat is
  not added to an interview, with consent, by then is lost.
- The **24-hour window** counts from the contact's **last inbound** message, not
  from Axal's last message. Outside it Axal sends nothing; the member asks the
  contact to write first.
- **Coexistence numbers and calls:** calls on a coexistence number stay in the
  WhatsApp Business app (third-party reports; unverified on Meta's page). No
  call reaches Axal, and `calls` is not subscribed.
- **5 MB** is the largest recording Axal takes from WhatsApp, the recorder's
  chunk limit (about 30–40 minutes of WhatsApp voice).
- A **consent reply counts only from the contact**, on that chat, answering that
  chat's open request. A message from the member's side, or an echo from the
  WhatsApp Business app, never counts.


## 7. General-availability release gates (D861, #2506)

**Do not change canary to on yet.** This section is a release checklist, not
an approval. W1 (#2501, setup) and W2 (#2502, translation) must merge first.
W5 (#2505) determines the connector's Calls wording; no call capture is
advertised until that outcome is implemented and verified.

### Evidence S1 reviews

1. Run the root build, then the full drift suite:
   `npm run build`, then
   `npm run test:drift > drift.log 2>&1; echo EXIT=$?`.
   Record the exit code and exact commit in the draft PR. The full suite
   includes the D861 readiness test and decision-id guard.
2. The focused command, from the repository root on the same commit, is:

   ```sh
node --experimental-strip-types --no-warnings \
  --import ./cloudflare-worker/test/_ts-loader.mjs \
  --test cloudflare-worker/test/whatsapp_readiness_d861.test.ts
```

   It runs isolated fixtures for development, preview and production, plus
   mutations. No request reaches Meta or production. Passing it proves the
   code gates; it does not prove a deployment has its secrets or approvals.
   Run the existing `whatsapp_switch_on_d754`,
   `channel_consent_d754` and `whatsapp_voice_audio_d754`
   suites as well; they cover webhook/late-job consent ordering and recorder
   integration. They are already in the full suite.
3. Review the limits: 120 webhook events per connection per minute, and 50
   transcriptions per connection per UTC day. The event counter fails open
   on a D1 fault to avoid losing incoming messages; the voice counter fails
   closed. A passing test does not make the event counter a hard outage quota.
4. Pending copies are swept after 30 days, at the next daily purge (03:50 UTC).
   A media lookup can expire earlier (7 days). An imported, consented
   transcript/recording stays until the member deletes the session; the
   pending-copy purge is not deletion of an interview.
5. Pending text and media references use the column cipher. Production needs
   its encryption key provisioned. Never use a fixture test's key, print a
   decrypted message, or export rows to prove this.
6. Repeat the real-device canary exercise after W1/W2 merge, including a
   declined/withdrawn consent, a waiting voice note, the shipped translation
   behaviour and one accepted proposal. Nothing populates Validate without
   the founder's Accept.
7. S1 records runbook review and the remaining decisions on #2506. The owner
   verifies the four Meta requirements in D861 §3 from official pages and
   confirms the app's actual approval state. Every UNVERIFIED requirement is
   a remaining release gate.

### The rollout PR

After all evidence is reviewed, the owner requests one PR changing
`WHATSAPP_CHANNEL` from `"canary"` to
`"on"` in both `[vars]` and
`[env.production.vars]` of `wrangler.toml`.
Review preview separately: its variables are not inherited and an absent
switch defaults to canary. Do not enable it incidentally. Generated branch
configs must be reviewed for their own intended audience before rollout.

The PR cites the verified Meta requirements, S1's review and the passing
commit's CI. It uses the normal build/migration/deploy workflow; the owner
merges. A missing approval, failed check or unreadable production check keeps
the rollout in canary.

### Read-only production verification

Use the successful deployment's status/log and the public health GET on
each host to establish that the expected build is serving. The existing
unsigned-webhook smoke (§2) checks rejection; do not send a fabricated signed
customer event to production.

An authorized operator may read these aggregates only, through the established
D1 read tooling. A failed read means **Unreadable**, never zero. Do not select
message text, ciphertext, contact names, phone numbers, identifiers or tokens.

```sql
SELECT status, COUNT(*) AS events
FROM channel_events
WHERE provider = 'whatsapp'
  AND datetime(created_at) >= datetime('now', '-1 day')
GROUP BY status;

SELECT COUNT(*) AS overdue_pending_messages
FROM channel_thread_messages m
JOIN channel_threads t ON t.id = m.thread_id
WHERE t.provider = 'whatsapp'
  AND datetime(m.sent_at) < datetime('now', '-30 days');

SELECT COUNT(*) AS pending_text_without_cipher_envelope
FROM channel_thread_messages m
JOIN channel_threads t ON t.id = m.thread_id
WHERE t.provider = 'whatsapp' AND m.kind = 'text'
  AND m.text_enc IS NOT NULL AND m.text_enc <> ''
  AND m.text_enc NOT LIKE 'v1.%';
```

A zero count is not evidence of consent or successful decryption. Correlate
the aggregate with the deployed CI evidence and purge completion. Overdue
pending rows can exist between the 30-day boundary and the next purge; if
they remain after its successful completion, investigate. No traffic means
"no events recorded", not a successful end-to-end exercise.

### Incident handling and rollback

- For consent, encryption or cross-member access concerns, stop intake first:
  the owner makes an urgent PR setting the switch to `"off"`
  in the affected deployed configurations. Use §5's off acknowledgement
  rather than deleting the app secret as the first response. Review already
  queued work too: rollout gates stop new downloads; they do not erase
  recordings already imported.
- For a compromised member connection, the member uses Disconnect. It stops
  further connection intake and removes pending thread copies; imported
  interviews remain. Verify Meta-side access revocation/unsubscription in
  the owner's dashboard. Do not describe a local disconnect as proof that a
  provider token was revoked.
- For a platform credential incident, the owner rotates/revokes access in
  Meta and provisions replacement secrets through the existing secret
  workflow. Never place the old or new value in a ticket, log or command
  argument.
- For purge failures, keep the rollout closed and restore the existing
  scheduled purge. Confirm completion with aggregate counts. Do not issue
  ad-hoc production DELETE/UPDATE statements from an agent session.
  A member removes an imported recording through the existing session
  deletion flow; the 30-day pending purge does not remove that session.
- Resume in canary, repeat the failed gate's checks and the real-device
  exercise, obtain S1's review, then use another owner-reviewed rollout PR.
