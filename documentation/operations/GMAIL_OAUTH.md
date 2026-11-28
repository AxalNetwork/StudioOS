# Gmail OAuth for the platform's outbound email

The `studioos` Worker sends its own email (sign-in links, verification,
notifications, newsletters, event reminders, signing requests) through the
Gmail API as one Google account. This runbook sets up, checks and rotates the
three secrets that make that work. It replaces the Worker folder's old
email setup guide (#9059).

It is **not** for a member's own mailbox: members connect their Gmail or
Outlook under the mail accounts feature, which uses its own client
(`MAIL_GMAIL_CLIENT_ID`, `MAIL_MICROSOFT_CLIENT_ID`; `services/mail/adapters/oauth.ts`).

## How it works

| Piece | Where |
| --- | --- |
| Secrets | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, Worker secrets on `studioos`. All three or nothing: every sender checks all three and sends nothing when one is missing. |
| Token exchange | The Worker trades the refresh token for a short-lived access token at `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) on each send. |
| Send | `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, so mail goes out as the Google account that granted the refresh token. |
| Code | `cloudflare-worker/src/services/email/send.ts` (the queued pipeline) and `services/email/gmail.ts` (the raw sender); older senders in `services/email.ts`. |
| Record | Each queued send is a row in the D1 table `email_send_log`: `status` (`queued`, `sent`, `failed`, `timed_out`, `dlq`) and `last_error`, e.g. `gmail_creds_missing` or `gmail_send_failed`. |

## 1. Create the Google client (once)

In the Google Cloud project that owns the sending account:

1. **APIs & Services → Library:** enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen:** fill in the app name and
   support email. Publish it **In production**. Google expires the refresh
   tokens of an External app left in Testing after seven days, and every send
   then fails.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   type **Web application**, authorized redirect URI
   `https://developers.google.com/oauthplayground` (used only to mint the
   refresh token in step 2). Keep the Client ID and Client Secret for §3.

## 2. Mint the refresh token

1. Open `https://developers.google.com/oauthplayground`, open the gear icon and
   tick **Use your own OAuth credentials**, and enter the Client ID and
   Client Secret.
2. In step 1 enter the scope `https://www.googleapis.com/auth/gmail.send`
   (sending is all the Worker does) and **Authorize APIs**, signed in as the
   sending account.
3. **Exchange authorization code for tokens** and copy the refresh token.
   Do not paste it anywhere but the command in §3.

## 3. Put the secrets on production

From the repository root (where `wrangler.toml` lives):

```bash
npx wrangler secret put GMAIL_CLIENT_ID     --config wrangler.toml --env production
npx wrangler secret put GMAIL_CLIENT_SECRET --config wrangler.toml --env production
npx wrangler secret put GMAIL_REFRESH_TOKEN --config wrangler.toml --env production
npx wrangler secret list --config wrangler.toml --env production   # names only
```

Setting a secret takes effect without a deploy and needs none. Never deploy
the Worker by hand to "pick it up": production ships only through the release
workflow ([DEPLOY.md](DEPLOY.md)).

## 4. Check it

1. `curl -s https://axal.vc/api/public/status` lists the service
   **Email delivery** with availability `Configured` once all three secrets
   are set. That is presence only, not a successful send.
2. Request a sign-in link at `https://axal.vc/login` for a mailbox you control.
   It should arrive from the sending account. If it does not, read the newest
   `email_send_log` rows and their `last_error`.

## 5. Rotate or recover

- **A revoked or expired refresh token** (the sending account's password
  changed, access removed in its Google account, or the app went back to
  Testing): mint a new one (§2) and put `GMAIL_REFRESH_TOKEN` again (§3).
- **A new client secret:** create it on the same client, put
  `GMAIL_CLIENT_SECRET`, check (§4), then delete the old secret in the console.
- **Stop all platform email:** delete `GMAIL_REFRESH_TOKEN`
  (`npx wrangler secret delete GMAIL_REFRESH_TOKEN --config wrangler.toml --env production`).
  Sends then fail with `gmail_creds_missing` instead of going out.

## Local development

`wrangler dev` reads the same three names from a `.dev.vars` file beside
`wrangler.toml` (the repository root; it is gitignored). Without them nothing
is mailed locally.
