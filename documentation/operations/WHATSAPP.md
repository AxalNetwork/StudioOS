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
  Each one becomes a draft interview after the member confirms consent. Way B
  exists only if the owner says yes (step 0a) and its three secrets are set.

**Not on `main` yet.** This runbook is written ahead of the code it describes.
Each part says what it waits on:

| Part | Lands with |
| --- | --- |
| `WHATSAPP_CHANNEL` read by the Worker (`off` / `canary` / `on`), 7-day voice-note deadline, split calling reasons | #1950 (D754 `w1_switch_on`, #1892) |
| Consent in the chat, the member's word, and the gate | #1954 (D754 `w2_consent`, #1893) |
| Voice notes stored and transcribed as recorder audio; consent and voice notes in Record a Session; the connector page | D754's S10, S11 and S07 tasks, not filed yet |
| Way B, Send to Axal | #1937 to #1939, and the owner's yes |
| Unsigned webhook refused, checked on every smoke run | This runbook's PR (`scripts/check-spa-live.mjs`) |

**Do not set the four WhatsApp secrets before #1950 and #1954 have merged.**
Until #1950 is on `main` the Worker does not read `WHATSAPP_CHANNEL`, so the
secrets alone would show WhatsApp to every member; until #1954 is on `main`,
a chat added to an interview would be kept without the interviewee's consent.

## 1. Owner steps, in order

Agent sessions cannot open `developers.facebook.com` or `business.facebook.com`;
every step here is done from the owner's machine.

0. **Three decisions**, answered on #1008 item 16 or to S1:
   - a. Way B, Send to Axal: yes or no. Axal's account pays Meta for that
     number's replies past 1,000 a month, about three replies per recording.
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
   - Before building it, read Meta's Embedded Signup v4 implementation page and
     tell S1 what the popup's `extras` should be: the launcher still sends
     `sessionInfoVersion: '3'`, and v2 and v3 were deprecated on 2026-10-15.
5. **Worker secrets, before the webhook.** Meta checks the verify token when the
   webhook is saved, and without the secrets the Worker answers 503. Run
   `npx wrangler secret put <NAME> --env=production` for each:
   - `WHATSAPP_APP_ID`;
   - `WHATSAPP_APP_SECRET` (App settings → Basic → App secret);
   - `WHATSAPP_VERIFY_TOKEN` (a long random string you make up);
   - `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` (step 4).

   They are not in Admin → Integration Keys. A secret needs no deploy.
6. **The webhook.** App Dashboard → WhatsApp → Configuration.
   - Callback URL: `https://axal.vc/api/channels/whatsapp/webhook`.
   - Verify token: the same string as `WHATSAPP_VERIFY_TOKEN`.
   - Subscribe `messages` and `smb_message_echoes` only. **Not `calls`**, and
     no template fields.
7. **Rollout.** `WHATSAPP_CHANNEL` ships `"canary"` in `[vars]` and
   `[env.production.vars]` of `wrangler.toml`. In canary only Super Admins can
   connect or link; members keep seeing "Not available yet". Nothing to do yet.
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
   is given, are stored and transcribed; that they are kept until the member
   deletes them; and how to delete them. Meta's app settings need the data
   deletion URL.
10. **The live check**, in canary, on a real device (§3).
11. **Billing check**, on Meta's pages: the October 2026 price of service
    messages (reported as free up to 1,000 a month per number, then the
    utility rate), and how Meta bills a Tech Provider's clients. D754 assumes
    each member's own WhatsApp Business Account pays for its replies, and Axal
    pays only for way B's number.

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

Do it in canary, signed in as a Super Admin, after #1950, #1954, D754's S10 and
S11 tasks, and S07's page have merged. Use two phones: phone 1 holds the test
business number, phone 2 plays the interviewee.

**Way A, your business number.**

1. Account → Connectors → WhatsApp: press **Connect WhatsApp Business**. Meta's
   popup opens; sign in and pick the test number. See: `•••• 1234`, its status,
   and "chats waiting".
2. From phone 2, send the test number a text and a voice note. See: the chat
   waiting in the inbox, and on the voice note "Add this chat to an interview by
   <date> to keep its voice notes".
3. Record a Session → Text chat → WhatsApp: pick that chat, name the
   interviewee, choose **Ask in WhatsApp**, press **Start**. See on phone 2: the
   consent notice with **Yes, I agree** and **No, thanks**. See in Axal:
   "Waiting for consent".
4. On phone 2, tap **Yes, I agree**. See in Axal: "Agreed in WhatsApp at
   <time>"; the text and the voice note's transcript on the session page; and
   Open recording plays the voice note.
5. From phone 2, send `STOP`. Send another text. See: nothing new arrives in the
   session, and **Discard this chat's recording** is offered. Press it.
6. Press **Disconnect**. See: the number gone, and its waiting chats with it.

**Way B, Send to Axal** (only if built).

1. Account → Connectors → WhatsApp: press **Link your WhatsApp**. See: a code,
   **Open WhatsApp**, and "expires in 10 minutes".
2. Press **Open WhatsApp** on your phone and send the pre-filled `LINK <code>`
   to Axal's number. See in WhatsApp: "Confirm in Axal to finish". See in Axal:
   "Is •••• 1234 your number? **Confirm**". Press **Confirm**.
3. Forward a voice note to Axal's number. See in WhatsApp: the consent question,
   with **Yes, out loud**, **Yes, in writing** and **No**. Tap **Yes, out loud**.
4. See in WhatsApp: "Saved to Axal" with a link. Open it, signed in: the draft is
   in Customer research as "Imported from WhatsApp", with its transcript.
5. Press **Unlink**.

If every step shows what it should, ask S1 to set `WHATSAPP_CHANNEL = "on"` in
both vars blocks of `wrangler.toml`, in one PR. It ships on the next deploy.

## 4. What a member sees, state by state (D754 §11)

| State | Members see | Super Admins also see |
| --- | --- | --- |
| Secrets unset | **Not available yet.** "Axal has not switched this on yet. There is nothing for you to set up until it does." | The missing secret names |
| `WHATSAPP_CHANNEL` is `canary` | Not available yet | "Only Super Admins can connect while WhatsApp is in canary." Then every state below |
| `WHATSAPP_CHANNEL` is `off`, with a connection | "Axal has switched this off for now. Your connection is kept, but nothing new arrives until it is back." | — |
| Sign-up ids malformed | "Not set up yet: Meta's sign-up is not configured on Axal." | — |
| A, not connected | **Your business number**, with **Connect WhatsApp Business** | — |
| A, connected | `•••• 1234`, status, chats waiting, **Test**, **Disconnect** | — |
| A, needs attention (token revoked, or the app unsubscribed) | "WhatsApp stopped accepting Axal's access. Connect again." | — |
| B, Axal's number unset | The section is hidden | The missing secret names |
| B, not linked | **Send recordings from your WhatsApp**, with **Link your WhatsApp** | — |
| B, linking | The code, **Open WhatsApp**, "expires in 10 minutes", then "Is •••• 1234 your number? **Confirm**" | — |
| B, linked | `•••• 1234`, last recording, **Unlink** | — |
| Calls line | "Calls: not yet. WhatsApp calls do not reach Axal; record a call with the in-app recorder instead.", then the connected number's own reason | — |

In Record a Session and Customer research a chat reads "Waiting for consent",
"Agreed in WhatsApp at <time>" or "Declined in WhatsApp"; a forwarded recording
reads "Imported from WhatsApp".

## 5. Rolling back

- **Switch it off for members:** set `WHATSAPP_CHANNEL = "off"` in both vars
  blocks and deploy (`documentation/operations/DEPLOY.md`). Connections are
  kept; members read "Axal has switched this off for now…"; the webhook still
  verifies signatures and answers Meta, but stores nothing, so Meta does not
  retry for 7 days. Set it back to `"canary"` or `"on"` to resume. Messages
  sent while it was off are not recovered.
- **Back to Super Admins only:** set it to `"canary"` and deploy.
- **Stop the webhook entirely:** in App Dashboard → WhatsApp → Configuration,
  unsubscribe the fields. Deleting the secrets also works (the webhook then
  answers 503 and Meta retries for up to 7 days), but it hides WhatsApp from
  Super Admins too.
- **Way B only:** delete one of `WHATSAPP_AXAL_ACCESS_TOKEN`,
  `WHATSAPP_AXAL_PHONE_NUMBER_ID` or `WHATSAPP_AXAL_WABA_ID` with
  `npx wrangler secret delete <NAME> --env=production`. The section hides and
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
