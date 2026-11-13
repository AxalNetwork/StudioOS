# OAuth Provider Registration — `axal.vc`

Task #5 (DC). All third-party OAuth callbacks now resolve through the
`axal.vc` apex (custom domain bound in `wrangler.toml`). Update each
provider's authorized redirect URI list to match before deploying:

## Google Cloud Console (Calendar)

1. https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client.
2. Authorized redirect URIs — add `https://axal.vc/api/calendar/google/callback`.
3. Remove any `https://*.workers.dev/api/calendar/google/callback` entries.
4. Authorized JavaScript origins — `https://axal.vc`.
5. Required scopes (already requested by the worker):
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `openid email profile`
6. App must be in **Production** (not Testing) for the refresh token to
   survive past 7 days. The worker requests `access_type=offline` +
   `prompt=consent`; refresh tokens then last 90+ days.
7. Set secrets:
   ```
   wrangler secret put GOOGLE_CLIENT_ID --env production
   wrangler secret put GOOGLE_CLIENT_SECRET --env production
   ```
   `GOOGLE_CALENDAR_REDIRECT_URI` is now optional — the worker derives
   `${APP_URL}/api/calendar/google/callback` when unset.

## Microsoft Entra ID (Outlook / Microsoft 365)

1. https://entra.microsoft.com → App registrations → New registration
   (or existing app).
2. Redirect URIs (platform = Web) — add
   `https://axal.vc/api/calendar/microsoft/callback`.
3. Remove workers.dev callback URLs.
4. API permissions → Microsoft Graph → Delegated:
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`
   - `openid email profile`
   Grant admin consent for the tenant.
5. Certificates & secrets → New client secret. Save the **value**.
6. Set secrets:
   ```
   wrangler secret put MICROSOFT_CLIENT_ID --env production
   wrangler secret put MICROSOFT_CLIENT_SECRET --env production
   # Optional: MICROSOFT_TENANT_ID (defaults to "common").
   ```
   `MICROSOFT_CALENDAR_REDIRECT_URI` is now optional — derived from
   `APP_URL` when unset.

## LinkedIn Developers (Refer & Earn sign-in)

1. https://www.linkedin.com/developers/apps → your app → Auth tab.
2. Authorized redirect URLs — add
   `https://axal.vc/api/linkedin/oauth/callback`.
3. Remove workers.dev redirect URLs.
4. OAuth 2.0 scopes — `openid`, `profile`, `email` (Sign In with
   LinkedIn using OpenID Connect product).
5. Set secrets:
   ```
   wrangler secret put LINKEDIN_CLIENT_ID --env production
   wrangler secret put LINKEDIN_CLIENT_SECRET --env production
   ```
   `LINKEDIN_REDIRECT_URI` is now optional — derived from `APP_URL`
   when unset.

## Custom domain (one-time)

`wrangler.toml` already declares the route. First deploy provisions
the cert automatically:

```
wrangler deploy --env production
```

Verify in the Cloudflare dashboard → Workers & Pages → studioos →
Triggers → Custom Domains. `axal.vc` should show "Active" with a
managed cert.

## Legacy workers.dev callbacks

After the provider apps are updated, hits to
`https://studioos.workers.dev/api/{calendar/google,calendar/microsoft,
linkedin/oauth}/callback` return **HTTP 410 Gone** in production
(`oauthCallbackWorkersDevGuard` middleware). Browsers and provider
retry loops will stop replaying stale URLs. The non-callback
workers.dev surface stays open for preview/debug.
