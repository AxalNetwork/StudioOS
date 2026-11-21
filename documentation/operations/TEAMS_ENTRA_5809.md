# Teams meetings on the Microsoft calendar app — Entra registration, live proof and recovery (#5809)

This runbook covers one "how do I": make the existing Microsoft calendar grant
create a Teams meeting for a licensed work or school organizer, prove it once,
and recover it.

The meeting is created by the Microsoft calendar connection (D1359). It is not
created by the meeting bot. The bot's calling app has its own registration,
permissions, tenant consent and validation (`MEETING_BOT.md`, D886). Nothing
here grants or tests it.

`cloudflare-worker/test/teams_entra_inventory_5809.test.ts` reads every value
in §1 from the code. If the code changes and this file does not, that test
fails.

## 1. Inventory — what the repo holds

| Item | Value in the code | Where |
| --- | --- | --- |
| Authority | `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/{authorize,token}` | `services/calendar.ts` `msAuthorize`, `msToken` |
| Tenant | `MICROSOFT_TENANT_ID`, else `common` (personal and work/school accounts) | `msTenant` |
| Delegated scopes asked | `openid profile email offline_access Calendars.ReadWrite User.Read` | `MICROSOFT_SCOPES` |
| Client id / secret | `MICROSOFT_CAL_CLIENT_ID` / `MICROSOFT_CAL_CLIENT_SECRET`, else the legacy `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | `microsoftCalClientId`, `microsoftCalClientSecret` |
| Redirect | `MICROSOFT_CALENDAR_REDIRECT_URI` if set (refused in production when it is on `*.workers.dev`), else `<OAUTH_CALLBACK_BASE_URL or PUBLIC_BASE_URL or APP_URL>/api/calendar/microsoft/callback` | `microsoftRedirectUri` |
| Member token store | `microsoft_oauth_tokens` (refresh token encrypted, the granted `scope`, email, `sub`), one row per member | `routes/calendar.ts` callback |
| Meeting call | `POST https://graph.microsoft.com/v1.0/me/events` with `isOnlineMeeting: true`, `onlineMeetingProvider: 'teamsForBusiness'`, starting now | `services/channels/teamsMeet.ts` `createTeamsMeeting` |
| Member action | `POST /api/founder/validate/meetings/instant` (Record a session) | `routes/founder_validate_meetings.ts` |
| Join link accepted | `https` on `teams.microsoft.com`, `teams.live.com` or `teams.cloud.microsoft` only | `teamsJoinUrl` |
| No-link path | an event with no join link is deleted again (`DELETE /me/events/{id}`), and the member gets `teams_personal_account` | `createTeamsMeeting` |
| Refusals | `teams_not_connected` (409), `teams_reconnect` (refresh 400/401, or Graph 401/403), `teams_personal_account` (409), `teams_create_failed` (502), `teams_unreachable` (429, 5xx or timeout; 503) | `TEAMS_ERRORS` |
| Disconnect | deletes the member's `microsoft_oauth_tokens` row; Microsoft has no per-grant revoke call here | `disconnectMicrosoft` |

**Callbacks per environment.** Each is derived from the environment's own
`wrangler.toml` vars.

| Environment | Resolved callback | Note |
| --- | --- | --- |
| production (`[env.production.vars]`) | `https://app.axal.vc/api/calendar/microsoft/callback` | `OAUTH_CALLBACK_BASE_URL` pins `app.axal.vc` |
| preview (`[env.preview.vars]`) | `https://studioos-preview.workers.dev/api/calendar/microsoft/callback` | the isolated test callback; preview sets only `APP_URL`, and named environments do not inherit top-level vars |

Register exactly these as **Web** redirect URIs on the app registration. Use
no wildcard and no SPA platform.

### Findings from the inventory (no code changed)

1. **Shared fallback client.** When neither `MICROSOFT_CAL_*` nor
   `MAIL_MICROSOFT_*` is set, calendar and Outlook mail
   (`services/mail/adapters/oauth.ts`: `Mail.Send`, and `Mail.Read` when
   reading) both use `MICROSOFT_CLIENT_ID`.
   - Microsoft issues a Graph access token carrying every delegated
     permission the member consented to on that app. A calendar refresh would
     then also carry mail permissions.
   - To keep calendar consent limited to calendar actions (criterion 4), set
     `MICROSOFT_CAL_CLIENT_ID` and `_SECRET` to an app registration used for
     nothing else.
2. **Granted scope is stored, not checked.** The callback saves whatever
   `scope` Microsoft returns. A grant without `Calendars.ReadWrite` connects,
   and then fails at meeting time with `teams_reconnect`.
   - §3 step 4 is where the operator reads the stored scope.
   - A code check is a separate change.
3. **The refresh token is not rotated into storage.**
   `refreshMicrosoftAccessToken` keeps only the access token, so every refresh
   reuses the refresh token saved at connect.
   - UNVERIFIED: whether the app's token lifetime policy lets that original
     refresh token outlive its own lifetime. If it does not, the member sees
     `teams_reconnect` and reconnects (§4).
   - Recording the rotated token is a separate change.

## 2. Configuration (owner only)

The owner holds the Entra tenant admin and app-owner roles. No agent sees a
credential value.

1. In Entra ID › App registrations, open the calendar app, or create one used
   only for the calendar. Record these in the evidence log (§5):
   - the application (client) id;
   - the object id;
   - the supported account types;
   - the owner;
   - each client secret's expiry.
2. **Supported account types** must match the tenant setting:
   - `MICROSOFT_TENANT_ID` unset (`common`) needs "Accounts in any
     organizational directory and personal Microsoft accounts".
   - A tenant id needs "single tenant".
3. **API permissions, delegated** (Microsoft Graph): `openid`, `profile`,
   `email`, `offline_access`, `User.Read`, `Calendars.ReadWrite`. Nothing else.
   - The meeting is an event with a Teams link, so no `OnlineMeetings.*` scope
     is needed.
   - No application permissions.
4. **Authentication › Web redirect URIs:** the callbacks in §1, exactly.
5. **Certificates & secrets:** create a secret with an expiry. Set it in that
   environment's Worker only:
   ```
   npx wrangler secret put MICROSOFT_CAL_CLIENT_ID     --config wrangler.toml --env <production|preview>
   npx wrangler secret put MICROSOFT_CAL_CLIENT_SECRET --config wrangler.toml --env <production|preview>
   npx wrangler secret put MICROSOFT_TENANT_ID         --config wrangler.toml --env <production|preview>   # only if single tenant
   ```
   - Alternatively use HQ › Integration keys, which stores the secret
     encrypted.
   - Never put a value in GitHub, an issue, the browser or a guest container.
   - `MICROSOFT_CALENDAR_REDIRECT_URI` stays unset unless an environment needs
     a callback other than the derived one.
6. **Rotation**, rehearsed in preview first:
   1. Add a second secret in Entra.
   2. Put it into the Worker.
   3. Connect and refresh once (§3, steps 2–4).
   4. Delete the old secret in Entra.

   **Rollback:** put the previous secret back into the Worker. It is valid
   until you delete it in Entra, so delete the old one only after the new one
   has refreshed. Members' stored refresh tokens survive a client secret
   rotation.

## 3. Live proof (owner only, preview first, then production)

Use an owned, licensed work or school organizer, a dedicated test member, and
no customer data. Record only environment, result and counts (§5).

1. In HQ › Integration keys, the Microsoft calendar shows configured, and
   preflight lists nothing missing.
2. As the test member, open Account › Connectors › Microsoft 365 and connect.
   Consent shows exactly the six permissions in §2.3.
3. The return lands with Microsoft connected. A wrong callback instead stops
   at Microsoft with `AADSTS50011` (redirect URI mismatch); record it as
   "wrong callback refused".
4. Read the stored grant: `SELECT scope FROM microsoft_oauth_tokens WHERE
   user_id = <test member>`. It contains `Calendars.ReadWrite` and
   `offline_access`. Record "scope ok", not the value.
5. Record a session › Create the meeting for me (Teams). One join link on
   `teams.microsoft.com` comes back. Record "1 link".
6. In the organizer's Outlook, delete the test event. Record "cleaned 1".
7. Repeat step 5 with a personal Microsoft account. Expect
   `teams_personal_account`, and no event left in that calendar (record
   "0 left").
8. In the organizer's My Apps, revoke the app, then retry step 5. Expect
   `teams_reconnect`. Reconnect (step 2) and retry. Expect one link, then
   clean up as in step 6.
9. Throttled or unavailable Graph cannot be forced live. It is covered by
   `cloudflare-worker/test/teams_create_meeting_d1359.test.ts` (a failed
   refresh) and `cloudflare-worker/test/teams_entra_inventory_5809.test.ts`
   (Graph 429 or 5xx gives `teams_unreachable`). Record
   "covered by test".

## 4. Recovery

| Symptom | Cause | Action |
| --- | --- | --- |
| `teams_reconnect` for every member | client secret expired or deleted | rotate (§2.6); members need not reconnect |
| `teams_reconnect` for one member | the member revoked consent, their refresh token lapsed, or the grant lacks `Calendars.ReadWrite` | the member reconnects; check step 4's scope |
| `AADSTS50011` at sign-in | callback not registered for this environment | add §1's exact URI as a Web redirect |
| `AADSTS700016` | client id not in the tenant the authority names | fix `MICROSOFT_TENANT_ID` or the supported account types |
| `teams_personal_account` for a work account | no Teams licence, or Teams disabled for the user | license the organizer or create the meeting in Teams |
| `teams_unreachable` | Graph throttled or down | retry later; nothing to change |

## 5. Evidence log

Write one line per step. Record no token, secret, email, event id or join link.

```
<date UTC> <environment> step <n> <result> <count>
```

## Roles

- **Owner:** tenant admin, app owner, secret holder, live proof.
- **Agents:** this runbook and the inventory test only.
