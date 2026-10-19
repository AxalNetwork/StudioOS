# GitHub connector: the StudioOS GitHub App

This runbook is for the owner, or a Super Admin. It fixes the GitHub card on
Account › Connectors when **+** answers "GitHub isn't set up on Axal yet, so it
can't be connected. Nothing was sent to GitHub." (`oauth_unconfigured`): no
client for the StudioOS GitHub App reaches the Worker. On 2026-10-18 the card
said "GitHub refused access … This integration is not yet configured on the
server" for the same cause.

It is not the ticket mirror. `TICKET_GITHUB_SYNC.md` and `GITHUB_ACCESS_TOKEN`
are the ticket mirror's: a token there does nothing for the connector, and this
runbook does nothing for the mirror.

**No value from this setup goes in a pull request, an issue, a chat or this
file.** Only variable names, URLs and setting labels do.

Each fact below carries the code line it comes from, as `path:line` on `main`
at `6e80eb5`. Where this file and the code disagree, the code wins: fix this
file.

## 1. What the connector needs

- **A GitHub App, not an OAuth App.** An OAuth App's only private-repository
  scope, `repo`, also grants write (`cloudflare-worker/src/integrations/providers/github.ts:4-9`,
  `documentation/architecture/decisions/D655.md:10-16`).
- **Two values:** `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`
  (`cloudflare-worker/src/services/providerOauthKeys.ts:73`). The connector
  reads no private key, no App ID and no webhook secret.
- **One optional var:** `GITHUB_APP_SLUG`, the `<slug>` in
  `github.com/apps/<slug>`. It is a wrangler **var**, not a secret, in both
  `[vars]` and `[env.production.vars]` (`wrangler.toml:177`, `:546`), and it
  ships empty. With a slug set, the repository read offers the App's install
  page (`github.ts:71-74`, `cloudflare-worker/src/routes/integrations.ts:865-866`).
- **The lookup order.** The Worker secret pair comes first, and both halves
  must be set. Otherwise the console's encrypted `provider_oauth_keys` row is
  read. Every answer, "none" included, is cached for 60 s per isolate
  (`providerOauthKeys.ts:93`, `:150-188`). With no pair, the start answers 503
  `oauth_unconfigured` before any sign-in state is written
  (`integrations.ts:1402-1405`).

## 2. Register the App (once)

On github.com: **AxalNetwork** → Settings → Developer settings → GitHub Apps →
**New GitHub App**. It needs an organization owner or a GitHub App manager.
The labels below are GitHub's as they read when this was written; check them
against GitHub's "Registering a GitHub App" page.

| Setting | Value | Why |
| --- | --- | --- |
| GitHub App name | `Axal StudioOS` | Members read it on GitHub's consent page, and the page says "allow Axal StudioOS" (`frontend/src/pages/account/connectorsModel.js:701`). If GitHub says the name is taken, pick another and tell S1, because the page names it. |
| Homepage URL | `https://axal.vc` | GitHub requires one. |
| Callback URL | exactly `https://app.axal.vc/api/integrations/oauth/github/callback`, with no trailing slash | `redirectUri` is `callbackBase` + `/api/integrations/oauth/github/callback` (`github.ts:49`, `:58-60`). `callbackBase` is `OAUTH_CALLBACK_BASE_URL`, then `APP_URL`, then `https://app.axal.vc` (`cloudflare-worker/src/util/url.ts:34-36`), and `OAUTH_CALLBACK_BASE_URL` is `https://app.axal.vc` in both blocks (`wrangler.toml:171`, `:541`). The same URI is sent at sign-in (`github.ts:486`) and at the token exchange (`:438`). Optionally add `https://axal.vc/api/integrations/oauth/github/callback` as a second callback, ready for the planned move to the apex (`wrangler.toml:162-168`). It does nothing until `OAUTH_CALLBACK_BASE_URL` changes. |
| Expire user authorization tokens | ticked | Tokens renew 60 s before they expire, under a lease (#1883, `github.ts:110`). A renewal GitHub refuses sets the connection to `github_sign_in_expired`, which shows Reconnect. |
| Request user authorization (OAuth) during installation | off | The callback needs both `code` and StudioOS's signed `state`. With either missing it answers a bare 400 `missing_code_or_state` (`integrations.ts:1495-1497`). Installing and signing in stay two separate steps. |
| Enable Device Flow | off | Nothing uses it. |
| Setup URL | `https://app.axal.vc/account/connectors/github`, with **Redirect on update** ticked | Brings an installer back to GitHub's page on Connectors (`frontend/src/App.jsx:2489`). Until #1884's page half lands, that only opens the page: the member presses **Choose** (`frontend/src/pages/account/ConnectorSheet.jsx:615`) to see the new repositories, which are read live on every open (`integrations.ts:855-866`). |
| Webhook | **Active** unticked, no events | The connector reads at sync time and has no webhook route. |
| Repository permissions | the four below, nothing else | See "Why exactly four". |
| Organization and Account permissions | none | Any entry here is overreach too. |
| Where can this GitHub App be installed? | **Any account** | Founders install it on their own repositories. An install gives Axal nothing until a member also signs in from StudioOS. |
| Private keys | do not generate one | The connector uses only user tokens. Nothing in the code reads a key. |

### Repository permissions

- **Contents:** Read-only
- **Issues:** Read-only
- **Metadata:** Read-only
- **Pull requests:** Read-only

**Why exactly four.** The registry asks for `issues:read`, `pull_requests:read`,
`contents:read` and `metadata:read` (`cloudflare-worker/src/integrations/registry.ts:406`).
The authorize URL carries no `scope`, because a GitHub App's permissions are
set on the App (`github.ts:483-487`). The grant is read back from every
installation, and `hasScopeOverreach` refuses **any** entry not in the list, a
read included (`cloudflare-worker/src/integrations/connectorRules.ts:5-8`). So
one extra permission on the App fails every connect with `scope_overreach`,
after the grant is revoked (`integrations.ts:1516-1525`), and every repository
choice with 403 `write_scope_refused` (`:895-908`). GitHub makes Metadata
Read-only mandatory once any repository permission is chosen. Never add a
permission on GitHub without first changing `oauth_scopes` in `registry.ts:406`
in a reviewed PR.

**Note the slug.** GitHub gives the App a public page, `github.com/apps/<slug>`,
probably `axal-studioos`. Members install the App from there. Post the slug on
#1008. A follow-up PR sets `GITHUB_APP_SLUG` to it in both `wrangler.toml`
blocks in one change, and the repository read then answers the App's install
page as `install_url` (`github.ts:71-74`). Until #1884's page half lands, the
page does not draw that link.

## 3. Client ID versus App ID

- The App's page shows a numeric **App ID** and a **Client ID** that starts
  with `Iv`.
- `GITHUB_APP_CLIENT_ID` is the **Client ID**. It goes into the authorize URL
  (`github.ts:486`), the token exchange (`:438`) and the revoke (`:471-480`).
- The App ID is for an App's own server-to-server sign-in, which StudioOS does
  not do. Putting it in makes Test read "GitHub rejected credentials
  (incorrect_client_credentials)."
- Press **Generate a new client secret** and copy it at once. GitHub shows it
  only then.

## 4. Put the pair in production

Use either path. Always set both halves: with one half missing, the Worker
ignores the pair and reads the table (`providerOauthKeys.ts:150-160`).

**(A) The console.**

- Open `https://axal.vc/admin?tab=integration-keys` → the **GitHub** card →
  **Configure**. Enter the Client ID and the Client Secret → **Save keys**.
- It needs a Super Admin with a TOTP session and a recent step-up
  (`cloudflare-worker/src/auth.ts:1041-1045`, D223).
- Save writes both halves as Worker secrets through the Cloudflare API, and
  rolls the ID back if the secret fails
  (`cloudflare-worker/src/routes/admin_integration_keys.ts:137-163`). So this
  Worker needs its own `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and
  `CLOUDFLARE_ACCOUNT_ID` as **Worker** secrets
  (`documentation/architecture/GOTCHAS.md:80`). The GitHub Actions secrets with
  the same names do not count.
- If the save answers "The Cloudflare API token is not set, so keys cannot be
  changed from here." (`admin_integration_keys.ts:89-95`), use (B).

**(B) Wrangler,** from the repository root, signed in with an account that can
edit the `studioos` Worker (`wrangler.toml:524`):

- `npx wrangler secret put GITHUB_APP_CLIENT_ID --config wrangler.toml --env production`
- `npx wrangler secret put GITHUB_APP_CLIENT_SECRET --config wrangler.toml --env production`
- Paste each value at wrangler's prompt. Never type it on the command line or
  pipe it in with `echo`, so it never reaches shell history.
- `npx wrangler secret list --config wrangler.toml --env production` lists
  names only, never values. Use it to confirm both are there.

Setting a secret changes no code and runs no migration. CLAUDE.md's "do not run
`npx wrangler deploy` by hand" is about deploys, and still holds.

## 5. Check it

1. **Test.** Integration keys → GitHub → **Test**. Expect "GitHub accepted the
   client credentials." (`cloudflare-worker/src/services/providerOauthTest.ts:245-257`).
   - "GitHub rejected credentials (incorrect_client_credentials)." means a
     wrong Client ID or secret (§3).
   - "No credentials configured for this provider." means this isolate does
     not see the pair yet (`providerOauthTest.ts:350`). Wait a minute and press
     Test again.
   - Test checks only the pair. It does not check the callback, the
     permissions or the install settings. Step 3 does.
2. **Wait about a minute.** Each isolate caches "no client" for 60 s, and
   isolates that booted before the secret existed keep their old env
   (`admin_integration_keys.ts:175-181`).
3. **Connect once, for real.**
   - Sign in at `https://axal.vc` as a founder, with a company chosen in the
     sidebar. GitHub writes into a company's project
     (`cloudflare-worker/src/integrations/companyScope.ts:6-7`), so the start
     refuses with `active_company_required` otherwise (`integrations.ts:1388`).
   - Account › Connectors → **GitHub** → **+** → continue to GitHub. Authorize.
     You land on the repository choice (`connectorsModel.js:493`).
   - If it says "No repository", install the App from `github.com/apps/<slug>`
     on one test repository, then press **Choose** again.
   - Pick the repository and a project → **Sync selected**. Expect "Synced …
     from 1 repositories." (`github.ts:599`).
   - Open the project's Product roadmap and Prototype / MVP: the issues and
     pull requests are there. Integration keys' GitHub card counts one active
     connection.

## 6. Rotate the secret

1. On the App's page, press **Generate a new client secret**.
2. Put it in production, with Integration keys → GitHub → **Rotate secret**
   (Super Admin, step-up; it needs the Cloudflare token as in §4 A), or with
   `npx wrangler secret put GITHUB_APP_CLIENT_SECRET --config wrangler.toml --env production`.
   A key held as a Worker secret cannot be rotated from the console without the
   token: the table fallback is refused for it, because the Worker secret wins
   over any row (`admin_integration_keys.ts:211-219`).
3. Press **Test**, wait a minute, then delete the old secret on GitHub.
4. The Client ID never changes, and members' connections carry on: their
   tokens are issued to the App, not to the secret.
5. Rotate whenever a secret may have been seen anywhere outside the two places
   in §4.

## 7. Replace or remove

- **Switch the connector off:** Integration keys → GitHub → **Remove** (Super
  Admin, step-up). Both Worker secrets are deleted, and every active GitHub
  connection becomes `disconnected` with `oauth_keys_revoked_by_admin`
  (`admin_integration_keys.ts:267-314`, `providerOauthKeys.ts:279`). Members
  read "Sign-in expired" (`connectorsModel.js:196` matches "revoked").
  - If the reply carries `cf_token_missing: true`, the Worker secrets are still
    live (`admin_integration_keys.ts:314`). Run
    `npx wrangler secret delete GITHUB_APP_CLIENT_ID --config wrangler.toml --env production`,
    and the same for `GITHUB_APP_CLIENT_SECRET`.
  - Members' authorizations stay on GitHub. Each can revoke theirs at GitHub →
    Settings → Applications → Authorized GitHub Apps. A member who disconnects
    in StudioOS revokes their own grant on GitHub, best effort (`github.ts:610`);
    the App stays installed on their repositories until they uninstall it.
- **Replace the App** (a new Client ID): **Remove** first, then set the new
  pair. The old App's tokens do not work with the new one, so every member
  reconnects. Register the new App exactly as in §2.
- **Retire it entirely:** delete the App on GitHub. GitHub documents that this
  uninstalls it everywhere and ends every authorization; it is not verified
  here.

## 8. Troubleshooting

| What you see | Code | Cause | Fix |
| --- | --- | --- | --- |
| "GitHub isn't set up on Axal yet, so it can't be connected. Nothing was sent to GitHub." The card reads "Not set up here" and has no **+**. | `oauth_unconfigured` (503 at the start, `integrations.ts:1402-1405`, `:545-563`) | No client pair reaches the Worker. GitHub was never contacted. | §4, then §5. |
| "Axal couldn't check whether GitHub is set up …" | `oauth_setup_unreadable` (503, `integrations.ts:1406-1412`) | No Worker secret, and the key table did not answer. | Wait a minute. Setting the pair as Worker secrets (§4 B) avoids the table entirely. |
| The return reads as not set up | `not_configured` (callback, `integrations.ts:1612`) | The pair was removed between the start and the callback. | §4. |
| "GitHub connects for one company. Choose a company in the sidebar, then connect again. Nothing was connected." (`connectorsModel.js:709`) | `active_company_required` (400 at the start, `integrations.ts:1388`); `company_not_linked` (callback, `:1505`) | GitHub writes into a company's project. No company is chosen, or the member is no longer linked to it. | Choose a company in the sidebar and connect again. |
| "This sign-in asked for more than StudioOS uses. Nothing was connected." (`connectorsModel.js:711`) | `scope_overreach` (callback, `integrations.ts:1516-1525`) | The App has a permission beyond the four. The grant was revoked. | Set the App back to exactly §2's four, then connect again. |
| "GitHub grants this connection more than read access. Change the StudioOS app to read-only in GitHub, then choose again." | `write_scope_refused` (403 at the repository choice, `integrations.ts:895-908`) | Same cause, found when repositories are chosen. The 403 body's `granted` names the extra permission, and an `overreach` row is logged. | Same fix, then choose again. |
| "GitHub refused access. (github_token_exchange_failed) …" | `github_token_exchange_failed` (`github.ts:441`) | GitHub refused the code exchange. GitHub's own code is kept only in the `activity_logs` row `integration_oauth_failed` (`integrations.ts:1603`): `incorrect_client_credentials` (wrong ID or secret), `redirect_uri_mismatch` (the App's Callback URL is not §2's) or `bad_verification_code` (the code expired or was used twice). | Press Test. If it fails, see §3 and §4. If it passes, check the Callback URL. Otherwise connect again. |
| A bare `{"error":"missing_code_or_state"}` page at the callback address | `missing_code_or_state` (400, `integrations.ts:1495-1497`) | "Request user authorization (OAuth) during installation" is on, so GitHub sent an installer to the callback without StudioOS's state. | Turn it off (§2). |
| A bare `{"error":"invalid_or_expired_state"}` page | `invalid_or_expired_state` (400, `integrations.ts:1498-1500`; TTL `cloudflare-worker/src/integrations/oauth.ts:18`) | The sign-in took more than 10 minutes, or the same return was opened twice. | Connect again. |
| "No repository · GitHub lists none this installation can read." (`frontend/src/pages/account/GithubRepositoriesPanel.jsx:186`) | `needs_install: true` on the repository read (`integrations.ts:865`) | The member authorized but never installed the App, or the App is installable "Only on this account". | Install from `github.com/apps/<slug>`, then **Choose** again. Set "Any account" (§2). |
| "Sign-in expired" | `github_sign_in_expired` (`github.ts:110`); `github_api_failed: 401` (`github.ts:89`) | GitHub refused to renew the sign-in, or the member revoked the App on GitHub. | The member presses **Reconnect**. |
| "Sign-in expired" on every GitHub card at once | `oauth_keys_revoked_by_admin` (`providerOauthKeys.ts:279`) | The pair was removed on Integration keys (§7). | Set the pair. Members press **Reconnect**. |
| Test: "GitHub rejected credentials (incorrect_client_credentials)." | `incorrect_client_credentials` (`providerOauthTest.ts:257`) | The App ID was used instead of the Client ID, or the secret is wrong or was deleted on GitHub. | §3, then set both halves again. |
| Save or Rotate: "The Cloudflare API token is not set, so keys cannot be changed from here." | `cloudflare_api_token_missing` (503, `admin_integration_keys.ts:89-95`) | This Worker has no Cloudflare token of its own (§4 A). | Use wrangler (§4 B), or set the Worker's token (`GOTCHAS.md:80`). |
| The sign-in was cancelled | `access_denied` (`connectorsModel.js:452`) | The member pressed Cancel on GitHub. | Nothing to fix. |

## 9. Not verified here

Nothing in this repository measured these, so they are not stated as facts
above:

- GitHub's exact labels and their order on the New GitHub App form.
- What GitHub does when the `redirect_uri` does not match the App's Callback
  URL: its own error page, or a redirect to the registered callback with
  `error=redirect_uri_mismatch`.
- Whether GitHub forwards StudioOS's `state` when "Request user authorization
  (OAuth) during installation" is on. This runbook keeps it off, so nothing
  depends on the answer.
- Whether an organization member's install waits for an organization owner's
  approval.
- Whether GitHub keeps an old client secret valid until it is deleted. §6's
  order (set the new one, Test, then delete the old one) is safe either way.
- What turning "Expire user authorization tokens" on or off does to tokens
  that already exist.
- Whether production holds `CLOUDFLARE_API_TOKEN` as a Worker secret today.
  Nothing here read production, so §4 gives both paths.
