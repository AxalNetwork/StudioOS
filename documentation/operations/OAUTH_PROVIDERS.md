# OAuth provider registration: callback URLs and client secrets

Each third-party sign-in or connection the `studioos` Worker offers is an OAuth
client registered with the provider. The provider only redirects to a callback
URL registered there, so the URL the Worker sends and the URL on the
provider's page must be identical. This runbook says which host the callbacks
use, and covers Google Calendar and LinkedIn. It replaces the Worker folder's
old provider guide (#9059), which named the wrong host (D722).

Other providers have their own runbooks:

| Provider | Runbook |
| --- | --- |
| Microsoft calendar app (Outlook, Teams meetings) | [TEAMS_ENTRA_5809.md](TEAMS_ENTRA_5809.md) |
| Google Meet transcripts, Zoom | [ZOOM_AND_MEET_TRANSCRIPTS.md](ZOOM_AND_MEET_TRANSCRIPTS.md) |
| GitHub connector (GitHub App) | [GITHUB_CONNECTOR_APP.md](GITHUB_CONNECTOR_APP.md) |
| "Continue with Google" sign-in (`GOOGLE_AUTH_CLIENT_*`) | `documentation/architecture/PRODUCTION.md` §4 |
| The platform's outbound Gmail | [GMAIL_OAUTH.md](GMAIL_OAUTH.md) |

## 1. Which host a callback uses

Every callback is built on `OAUTH_CALLBACK_BASE_URL` when it is set:
`callbackBase()` in `cloudflare-worker/src/util/url.ts` falls back to
`APP_URL`, and the calendar's `appBase()` in `services/calendar.ts` to
`PUBLIC_BASE_URL`, then `APP_URL`. Production sets `OAUTH_CALLBACK_BASE_URL = "https://app.axal.vc"`
in `[env.production.vars]` (and the top-level `[vars]`), so **production
callbacks are on `https://app.axal.vc`**, not the apex, even though
`APP_URL` is `https://axal.vc`. Read the value in `wrangler.toml` before you
register anything; when the variable is removed, every callback moves to
`https://axal.vc` and each provider must list that host first.

Connectors under `/api/integrations/oauth/<key>/callback` use the same base
(`oauthCallbackUrl`), and HQ › Integration keys shows each one's exact URL.

The calendar and LinkedIn callbacks also accept an explicit override
(`GOOGLE_CALENDAR_REDIRECT_URI`, `MICROSOFT_CALENDAR_REDIRECT_URI`,
`LINKEDIN_REDIRECT_URI`). None is set in `wrangler.toml`, and production
ignores one that points at a `*.workers.dev` host. A request to those three
callbacks on a `*.workers.dev` host in production answers **410 Gone**
(`oauthCallbackWorkersDevGuard` in `cloudflare-worker/src/index.ts`), so a
provider still registered on workers.dev fails visibly.

## 2. Google Calendar

The Calendar connector's own Web client (`services/calendar.ts`).

| | |
| --- | --- |
| Secrets | `GOOGLE_CAL_CLIENT_ID`, `GOOGLE_CAL_CLIENT_SECRET`; the legacy `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are read when those are unset. |
| Redirect URI | `https://app.axal.vc/api/calendar/google/callback` (§1) |
| Scopes the Worker asks for | `calendar.events`, `calendar.readonly`, `userinfo.email`, `userinfo.profile`, `openid`; plus the Meet scopes once Meet transcripts are on, and `drive.file` for Workspace files |
| Offline access | `access_type=offline` with a consent prompt, so Google returns a refresh token |

In the Google Cloud console (APIs & Services → Credentials → the Calendar
client):

1. Add the redirect URI above under **Authorized redirect URIs**, and remove
   any `*.workers.dev` entry.
2. Keep the OAuth consent screen **In production**. Google expires the refresh
   tokens of an External app left in Testing after seven days.
3. Put the secrets (from the repository root):

   ```bash
   npx wrangler secret put GOOGLE_CAL_CLIENT_ID     --config wrangler.toml --env production
   npx wrangler secret put GOOGLE_CAL_CLIENT_SECRET --config wrangler.toml --env production
   ```

The Meet scopes need Google's verification and their own switch; that is
[ZOOM_AND_MEET_TRANSCRIPTS.md](ZOOM_AND_MEET_TRANSCRIPTS.md).

## 3. LinkedIn (Refer & Earn and contact import)

`routes/linkedin.ts`: Sign In with LinkedIn (OpenID Connect) attaches a
verified LinkedIn identity to the member.

| | |
| --- | --- |
| Secrets | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Redirect URL | `https://app.axal.vc/api/linkedin/oauth/callback` (§1) |
| Scopes | `openid profile email` (the "Sign In with LinkedIn using OpenID Connect" product) |

1. LinkedIn Developers → the app → **Auth** → **Authorized redirect URLs**: add
   the URL above and remove any `*.workers.dev` URL.
2. Put the secrets, either in HQ › Integration keys or from the repository
   root:

   ```bash
   npx wrangler secret put LINKEDIN_CLIENT_ID     --config wrangler.toml --env production
   npx wrangler secret put LINKEDIN_CLIENT_SECRET --config wrangler.toml --env production
   ```

## 4. After a change

Setting a secret needs no deploy. A change to `OAUTH_CALLBACK_BASE_URL` or any
other `wrangler.toml` value is a pull request, shipped by the release workflow
([DEPLOY.md](DEPLOY.md)); never deploy the Worker by hand. Register the new
callback with every provider **before** that release lands, then remove the old
one after it.

Check by connecting a test account: Google Calendar from the member's
connectors, and LinkedIn from Refer & Earn (`/referrals`). A
`redirect_uri_mismatch` (Google) or "redirect_uri does not match" (LinkedIn)
page means the registered URL and §1 disagree.
