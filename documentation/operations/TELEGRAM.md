# Telegram Business: switch on, check, rotate, switch off

The owner's runbook for the Telegram Business interview bot (D756, which amends
D684). It is everything needed to set the bot up, run the real-device check,
rotate its secrets and switch it off. Secret and variable names only: no value
belongs in this file, in the repo, or in an issue.

A member links their Telegram account to Axal, then adds Axal's bot as a
chatbot in Telegram › Settings › Telegram Business › Chatbots and chooses
which chats it may read. Those chats wait in the member's inbox until the
member adds one to an interview. Everything arrives through one webhook,
`https://axal.vc/api/channels/telegram/webhook`.

This is a **different bot** from the news bot behind `TELEGRAM_BOT_TOKEN`
(GOTCHAS.md, "Telegram broadcaster"). A bot that receives customer
conversations must be revocable on its own.

**What has shipped.** Every part of D756 this runbook relies on is on `main`
except #1978, which §3 step 6 waits on:

| Part | PR |
| --- | --- |
| The bot's health and **Register webhook** on `/admin/telegram`; the 24-hour window from the contact's last message; the `bizChat` button's answer | #1963 (D756 `S10-ready`, #1895) |
| `TELEGRAM_CHANNEL` read by the Worker (`off` / `canary` / `on`), for both providers | #1950 (D754 `w1_switch_on`, #1892) |
| D754's consent store and gate | #1954 (D754 `w2_consent`, #1893) |
| The recording notice page, `/privacy/interviews` | #2023 (D756 `S11-notice`, #1894) |
| Voice notes, audio files and round videos read, with the 5 MB cap | #2051 (D756 `S13-media`, #1896) |
| The interviewee's YES, NO and STOP in the chat | #1998 (D756 `S12-consent`, #1977) |
| The connector page, `/account/connectors/telegram` | #1997 (D756 `S07-page`, #1979) |
| Consent state and notes in Record a Session and the inbox | #2004 (D756 `S11-validate`, #1981) |
| Notes stored and transcribed as recorder audio | **#1978 (D756 `S13-audio`), not merged** |
| Yes/No buttons on the notice | D756's buttons task, not filed: it waits on §3 step 10's probe |

**What a Telegram chat holds for consent.** Unlike WhatsApp, an assigned
Telegram chat's **text** goes into its session at once, under D684's rule; only
its **notes** wait. A note is fetched only once the interviewee has said YES. A
NO keeps the notes held; a STOP stops further downloads; neither sets the chat
aside. Until #1978 merges, a consented note is transcribed as D684 §4 step 4
describes, and only its text is kept; after #1978 its audio is stored and
transcribed as recorder audio. Setting the secrets is safe: `TELEGRAM_CHANNEL`
ships `canary`, so only Super Admins can link.

## 1. Owner steps, in order

Agents never see any of these values.

1. **@BotFather (Telegram).**
   - Send `/newbot`. Give it a display name (for example "Axal VC") and a new
     username ending in `bot`. It must be a **new** bot, not the news bot.
   - `/mybots` → the new bot → Bot Settings:
     - **Business Mode → Turn on.**
     - **Allow Groups → Turn off.** The channel reads private chats only.
   - Leave inline mode, payments, Mini App and the menu button off.
   - `/setdescription`: "Axal VC's bot for founders. Link it from Axal ›
     Account › Connectors, then add it in Telegram › Settings › Telegram
     Business › Chatbots. It reads only the chats you choose."
   - `/setabouttext`: "Brings the customer chats you choose into Axal VC."
   - `/setuserpic`: the Axal mark.
   - Copy the token straight into step 2. Never paste it in a chat, an issue
     or a file.
2. **The three Worker secrets**, from the repo root:
   - `npx wrangler secret put TELEGRAM_CHANNEL_BOT_TOKEN --env production`: the
     BotFather token.
   - `npx wrangler secret put TELEGRAM_CHANNEL_BOT_USERNAME --env production`:
     the bot's username. A leading `@` is stripped.
   - `npx wrangler secret put TELEGRAM_CHANNEL_WEBHOOK_SECRET --env production`:
     a fresh random value, for example the output of `openssl rand -hex 32`.
     Telegram allows 1–256 characters from `A–Z a–z 0–9 _ -`.

   A secret needs no deploy. `PUBLIC_BASE_URL` is already `https://axal.vc`,
   so no var is needed for the webhook address.
3. **Register the webhook.** Signed in to axal.vc as a Super Admin, open
   `/admin/telegram` and press **Register webhook** in the "Telegram Business
   bot (interviews)" section. It calls
   `POST /api/admin/channels/telegram/webhook`, which registers
   `https://axal.vc/api/channels/telegram/webhook` with the secret, the update
   list (`message`, `business_connection`, `business_message`,
   `edited_business_message`, `deleted_business_messages`) and
   `drop_pending_updates: false`, and answers 200 with `ok`, `url` and
   `allowed_updates`. **Never call Telegram's `setWebhook` yourself.**
4. **Check the health.** The same section reads
   `GET /api/admin/channels/telegram/webhook` (press **Check again** to re-read)
   and should say the bot is ready. Ready means Telegram answered, and:
   - Business Mode is on;
   - the username matches `TELEGRAM_CHANNEL_BOT_USERNAME` (a wrong one makes
     every `t.me` link point at someone else's bot);
   - it is not the news bot behind `TELEGRAM_BOT_TOKEN`;
   - the webhook is registered, at axal.vc;
   - the update list is current;
   - no delivery error in the last 24 hours. An older one is still shown.

   The number of updates waiting is shown but never blocks ready. With a secret
   unset the section names the missing secrets and calls nothing. It shows
   codes and sentences only, never the token or the secret. A Super Admin sees
   the same section on `/account/connectors/telegram`.
5. **Premium check.** Open Telegram › Settings › Telegram Business on an
   account **without** Telegram Premium and report on #1008 whether Chatbots
   needs Premium. Sources disagree on whether that changed in 2026; the card's
   "Needs Telegram Premium" stays until you report.
6. **The notice.** Approve, with counsel, the in-chat notice and the
   `/privacy/interviews` page (#1894), and name the contact address for
   deletion requests.
7. **The live check**, in canary, on a real device (§3).
8. **Ask S1 to switch it on:** `TELEGRAM_CHANNEL = "on"` in both vars blocks
   of `wrangler.toml`, in one PR (§4).

## 2. The automatic check

The webhook refuses any update without the right secret header before it reads
the body: 503 `not_configured` while the secret is unset, 401 when the header is
missing or wrong. This is tested on fixtures in
`cloudflare-worker/test/channels_messaging_d684.test.ts`; no CI job calls
Telegram. A hand check from any machine:

- an unsigned `POST https://axal.vc/api/channels/telegram/webhook` answers 401
  (503 before the secrets);
- after step 3, the health section shows the webhook registered with no
  last error.

## 3. The live check on a real device

Do it in canary, signed in as a Super Admin, from an account **with** Telegram
Premium (account 1), with a second Telegram account playing the interviewee
(account 2). Everything but step 6's audio can be checked on `main` today; run
step 6 once #1978 has merged, or run the whole check then.

1. **Link.** Account → Connectors → Telegram: press **Link Telegram**. Open the
   `t.me` link on account 1's phone and press Start; send `/confirm` when the
   bot asks; then press **Confirm** in Axal. Both halves must happen within ten
   minutes. See: "Your Telegram account is linked. Add the Axal bot in Telegram
   Business to start receiving chats."
2. **Add the bot as a chatbot.** On account 1: Telegram › Settings › Telegram
   Business › Chatbots, add the bot by its username, and choose one test chat
   with account 2. Allow replies. In Axal press **I've done this. Check
   again**. See: **Connected**, with the bot's @username.
3. **Send the four kinds.** From account 2, in that chat, send a text, a voice
   note, an audio file (under 5 MB) and a round video. See in Axal: the chat
   waiting in the inbox, its text, and each of the three as "Voice note,
   transcribed when you add this chat to an interview". None is downloaded.
4. **Assign.** Record a Session → Text chat → Telegram (or the inbox): pick the
   chat, name the interviewee, and add it to an interview. See: the text in the
   session at once, the notes still waiting, and the consent line "Not asked
   yet".
5. **Ask for consent.** Press **Ask for consent in Telegram**. See on account 2:
   the notice, sent in account 1's name, with the link to
   `/privacy/interviews`. See in Axal: "Asked at <time>". Reply **YES** from
   account 2, as a reply to the notice or as its next message, within 7 days.
   See on account 2: "Thank you. This chat is now recorded for {venture}'s
   research. Reply STOP at any time." See in Axal: "YES at <time>", and the
   notes start to be fetched.
   - Also try the copy path once on another chat: **Copy the notice**, paste it
     yourself from account 1, and reply YES from account 2. It counts the same.
6. **Audio and speakers** (needs #1978). On the session's review: the voice
   note and the audio file play; the transcript shows "Me" and the interviewee
   by side, never "Speaker ?". The round video is never fetched and reads
   "Round video messages can't be transcribed yet." Before #1978, the voice
   note and the audio file arrive as transcribed text only.
7. **STOP.** Reply **STOP** from account 2. See on account 2: "Understood.
   Recording has stopped for this chat. To have what was already recorded
   deleted, just ask me." See in Axal: "Stopped". Send another voice note from
   account 2: it is not fetched. What was stored before stays until the member
   deletes it.
8. **Disconnect.** Press **Disconnect** in Axal. See: pending chats forgotten;
   the interview keeps what it already holds.
9. **The `bizChat` button.** In Telegram, press the chat's "manage" button for
   the bot. See in the bot's private chat: "To manage this chat, open Axal ›
   Interviews."
10. **The inline-button probe.** Report on #1008 whether a test inline button
    press reached the bot. It decides whether D756's buttons task is filed.

Post the result for S1 on #1008, items 4, 5 and 16. If every step showed what it
should, do §1 step 8.

## 4. Rollout, rotation and the off switch

**Rollout.** `TELEGRAM_CHANNEL` is a wrangler **var**, not a secret, in both
`[vars]` and `[env.production.vars]`: `"off"`, `"canary"` or `"on"`; absent or
anything else means `"canary"` (#1950). It ships `"canary"`: only Super Admins
can link or connect, and members see "Not available yet". After §3 passes, set
both blocks to `"on"` in one PR; it ships on the next deploy.

**Rolling back.**

- **Off for members:** set `TELEGRAM_CHANNEL = "off"` in both blocks and deploy
  (`documentation/operations/DEPLOY.md`). Connections are kept; connected
  members read "Axal has switched this off for now. Your connection is kept,
  but nothing new arrives until it is back." The webhook still checks the
  secret and acknowledges, but stores nothing.
- **Back to Super Admins only:** `"canary"` and a deploy.
- **Off entirely, without a deploy:**
  `npx wrangler secret delete TELEGRAM_CHANNEL_WEBHOOK_SECRET --env production`.
  The webhook then answers 503 and Telegram retries for a while; to stop the
  retries too, revoke the token in BotFather (`/revoke`).

**Rotating the webhook secret.** Put the new
`TELEGRAM_CHANNEL_WEBHOOK_SECRET`, then press **Register webhook** at once.
Updates answer 401 in between, and Telegram retries them.

**Rotating the token.** `/revoke` in BotFather, put the new
`TELEGRAM_CHANNEL_BOT_TOKEN`, then press **Register webhook**.

**After any change to the update list** (`TELEGRAM_ALLOWED_UPDATES` in
`cloudflare-worker/src/services/channels/telegram.ts`), press **Register
webhook** again. The health section says the registered list differs until you
do. The buttons task, if it ships, adds `callback_query` and needs this.

No rollback deletes what members already added to interviews: consented audio
and transcripts stay until the member deletes them.

## 5. Things that catch people out

- **Two bots.** `TELEGRAM_BOT_TOKEN` is the news broadcaster;
  `TELEGRAM_CHANNEL_BOT_TOKEN` is this one. Rotating one never touches the
  other.
- **The 24-hour window** counts from the contact's last message (Telegram's
  "incoming messages in the last 24 hours"), not from the member's. Outside it
  Axal sends nothing, the notice included; the member pastes the notice
  instead.
- **5 MB** is the largest note Axal takes, the recorder's chunk limit, not
  Telegram's 20 MB. A larger note is refused on its declared size before any
  download.
- **A consent answer counts only from the contact**: the chat's own user, not
  the member, not a business bot, not an offline auto-reply, within 7 days of
  the notice, as a reply to it or the contact's first message after it.
- **No `file_id` expiry is documented**, so Telegram notes show no "keep by
  <date>" line. That line is WhatsApp's 7-day rule.
- **No calls.** The Bot API has none; a Telegram call is recorded with the
  in-app recorder (channel `phone`).
