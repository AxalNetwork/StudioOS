# Axal StudioOS – Production Deployment Guide

Single source of truth for deploying StudioOS to production. Covers the
Cloudflare Worker (canonical production API, and the SPA on both `axal.vc`
and `app.axal.vc`), the frontend bundle it serves, secrets, and the
post-deploy checklist.

---

## 1. Architecture in 30 seconds

| Component        | Tech                       | Hosted on                              | Source                                          |
| ---------------- | -------------------------- | -------------------------------------- | ----------------------------------------------- |
| **Public API**   | **TypeScript + Hono**      | **Cloudflare Workers** (`axal.vc`)     | `cloudflare-worker/src/index.ts` + `routes/`    |
| Database         | Cloudflare D1 (SQLite)     | Cloudflare (`studioos-db`)             | bound as `env.DB`                               |
| WebSocket fan-out| Durable Objects            | Cloudflare Workers                     | `cloudflare-worker/src/durable-objects/`        |
| Cache / sessions | KV                         | Cloudflare KV (`TOKENS`, `RATE_LIMITS`)| n/a                                             |
| MCP OAuth        | OAuth 2.1 + KV             | Cloudflare KV (`OAUTH_KV`)              | `cloudflare-worker/src/mcp/oauth.ts`             |
| Job queue        | Cloudflare Queues + cron   | Cloudflare                             | `cloudflare-worker/src/services/queueWorker.ts` |
| File storage     | R2                         | Cloudflare R2 (`studioos-files`)       | bound as `env.FILES`                            |
| Vector search    | Vectorize                  | Cloudflare (`axal-search`)             | bound as `env.VECTORIZE`                        |
| Dev backend      | FastAPI (Python)           | Local Replit only                      | `backend/`                                      |
| Frontend         | React + Vite               | **Cloudflare Workers** — the `studioos` Worker's `[assets]` copy of `docs/`, on `axal.vc` + `app.axal.vc` | `frontend/`                                     |

> **Architecture reality (revised 2026-04-28):** Earlier "audit #4" notes proposed
> making FastAPI the canonical backend with the worker as a thin proxy via
> `FASTAPI_ORIGIN`. That migration was never completed: the 23 production user
> accounts live in D1, which only the worker can reach, and FastAPI is not
> publicly deployed. The Cloudflare Worker is therefore the production API and
> the source of truth for `/api/*`. FastAPI in `backend/` is the local dev
> backend used during Replit iteration; do not point production traffic at it.

---

## 2. Release blockers (run before every prod deploy)

- [ ] **`POST /api/search/backfill`** — re-vectorise legacy semantic-search
      rows (audit #7). The runtime scrub keeps queries safe but old vectors
      stay stale until the backfill runs. Trigger it once after every schema
      change that touches a `*_embedding` column. Admin-only.
- [ ] Confirm `JWT_SECRET` is set on the worker
      (`wrangler secret put JWT_SECRET`). The worker fails fast at the top of
      every request if it's missing or weak.
- [ ] Confirm wrangler is authenticated against the right Cloudflare account
      (`wrangler whoami`).

---

## 3. Deploy

### Cloudflare Worker (production API)

```bash
wrangler secret put JWT_SECRET   # used for auth + Durable Object WS handshake
npm run deploy                   # from the REPOSITORY ROOT
```

`npm run deploy` is not a synonym for `wrangler deploy`. npm expands it into
three scripts: `predeploy` applies pending D1 migrations
(`scripts/migrate-d1.mjs --remote`), `deploy` builds the frontend and then runs
`wrangler deploy --config ../wrangler.toml --env production`, and `postdeploy`
probes the live site (`scripts/check-spa-live.mjs`). Running wrangler by hand
skips the migration hook and ships the worker ahead of its schema.
`npm run deploy` from inside `cloudflare-worker/` once did the same; that
script now hands off to the root one (DEPLOY.md §1.1).

**The full procedure, with pre-flight, migration-failure triage and rollback, is
[documentation/operations/DEPLOY.md](../operations/DEPLOY.md).**

> ✅ **Verified 2026-05-06:** `--env production` IS the correct deploy command.
> The `[env.production.*]` block in `wrangler.toml` redeclares
> every binding (D1, KV `TOKENS`/`RATE_LIMITS`, R2 `studioos-files`, Queue
> `studioos-job-queue`, AI, Durable Objects), so the live worker has all bindings
> intact — confirmed by `GET /accounts/.../workers/scripts/studioos/bindings`.
> An earlier note in this file warned against `--env production` because the env
> block historically didn't redeclare bindings; that's no longer true.

**2026-10-14:** the production deploy of `710f0ae19` (Actions run 38539060463,
09:00:26Z) was the first to list `env.OAUTH_KV (a536c75e7461447a89b1967d367c13ad)`
and `env.MCP_SERVER_ENABLED ("true")` among the Worker's bindings. The deploy of
`dd5b1d49a` (run 38539746250, 09:05:58Z) listed both again. See "MCP
enablement" below.

### Frontend

There is no separate frontend deploy. `axal.vc` and `app.axal.vc` are both
whole-host Workers Custom Domains of the `studioos` Worker (`wrangler.toml`
`[[routes]]` and `[[env.production.routes]]`, each `custom_domain = true`),
and the Worker serves the SPA on both from its own `[assets]` binding
(`directory = "./docs"`, `not_found_handling = "single-page-application"`,
`run_worker_first` for `/api/*`, `/landing/*`, `/p/*` and `/assets/*`). One
build sits behind both hosts and they ship together on every
`wrangler deploy` — `npm run deploy` by hand, or
`.github/workflows/cloudflare-worker-deploy.yml` on every push to `main`. A
deploy's closing `Deployed studioos triggers: axal.vc (custom domain),
app.axal.vc (custom domain)` lines are what settle who serves the hosts.

That has been the shape since 2026-09-01 (`1d320dda9`, "Remove stale
documentation asset files", which replaced the Pages cutover's three
path-scoped apex routes with the whole-host `axal.vc` custom domain). The
`studioos` Cloudflare Pages project (`studioos-2p8.pages.dev`) kept receiving
a mirror build from `cloudflare-pages-deploy.yml` until 2026-09-03, when the
mirror, that workflow and the `_worker.js` that ran only there were retired
(`DECISIONS.md` D36) — its dashboard had shown "Production" deployments for
two commits whose Worker deploy failed in the migration step. Nothing ships a
build anywhere but the Worker. The static security headers on assets-binding
responses come from `docs/_headers` (built from `frontend/public/_headers`,
read natively by Workers static assets), and `scripts/check-spa-live.mjs`
asserts them on every shell route after a deploy.

`docs/` is **not committed** (D529). It is gitignored, and every job that
needs it builds it from `frontend/src` at the REPO ROOT (`npm run build`, which
also prerenders the crawlable routes): CI's full suite and Open Graph check,
the PR preview, branch provisioning and the deploy. The deploy restores the
previous deploy's `docs/assets` and retention ledger from the Actions cache
before it builds, so a tab opened before the deploy keeps its chunks
(DEPLOY.md §2.1).

### FastAPI (dev only)

`backend/` runs in the local Replit workflow `Backend API` for development.
It's not part of the production deploy path.

---

### MCP enablement (D681, #1555)

`OAUTH_KV` holds the MCP provider's clients, grants, tokens and parked consent requests. The owner created HQ's namespace on 2026-10-13; its non-secret id is `a536c75e7461447a89b1967d367c13ad`. `wrangler.toml` binds it at the top level and in `[env.production]`, nowhere else. `MCP_SERVER_ENABLED = "true"` at the top level and in production. `mcpEnabled` needs both the flag and a binding.

`[env.preview]` keeps the flag `"false"` and binds `OAUTH_KV` to the placeholder `REPLACE_WITH_PREVIEW_KV_OAUTH_ID` until the operator creates preview's own namespace (`npx wrangler kv namespace create OAUTH_KV-PREVIEW`, in the list above `[env.preview]`). It must never bind HQ's. Grants are keyed by numeric user id, preview has its own D1, and `revokeAllGrants` runs whenever a binding is present, flag on or off, so a preview Worker on HQ's namespace could revoke an HQ member's assistant grants. `checkMcpDeployment` in `cloudflare-worker/test/mcp_server_d666.test.ts` reads `wrangler.toml` through the installed wrangler's own config reader, `unstable_readConfig`, once for the top level and once for every environment the file's `env` table declares (wrangler's raw parse, `experimental_readRawConfig`, names them; `production` and `preview` must be among them), so it checks the bindings `wrangler deploy` would ship however the TOML spells them; a config or an environment wrangler cannot read fails the test. It fails when any of those scopes declares an `unsafe` key, inline or as a table: `wrangler.toml` declares none, and `unsafe.bindings` or `unsafe.metadata.bindings` can name a D1 or KV id that the store comparison never reads. It pins the flags and HQ's OAuth id at the top level and in production. Every other environment, `[env.preview]` and any added later, must set `MCP_SERVER_ENABLED = "false"`, every D1 binding there must name its own `database_id` and every KV binding its own `id` (a D1 binding with no `database_id` is looked up by `database_name` at deploy, so none there may use a `database_name` HQ's D1 uses), and the test fails when any D1 or KV binding there names a store id (`id`, `preview_id`, `database_id` or `preview_database_id`) that a D1 or KV binding at the top level or in `[env.production]` names. The ids it compares have their quotes stripped and escapes decoded, as wrangler reads them, and are then lower-cased so a hex id matches in any case. The `REPLACE_WITH_PREVIEW_*` placeholders pass. Branch configuration generation keeps MCP off and omits HQ's OAuth store; branch enablement requires separately provisioned branch storage.

**Live since 2026-10-14 09:00:26Z.** The deploy of `710f0ae19` (Actions run 38539060463, Worker version `279b51c2-077d-41d0-b549-f2884ebb8213`) switched MCP on in production, and every deploy of `main` since carries it. The owner's D669 MCP Inspector report on #1495 (connect, read context, submit a consented test interview, confirm a pending placement) is still outstanding, and it is now a check against production. The ordinary PR preview is an unbound SPA Worker and cannot run it.

**Switching MCP off.** `checkMcpDeployment` pins the top-level and production flags to the `HQ_MCP_FLAG` constant in the same test file, and the "Cloudflare Worker deploy" workflow (`.github/workflows/cloudflare-worker-deploy.yml`) deploys `wrangler.toml` as committed, with whatever flag it commits, on every push to `main` and whenever it is dispatched (`workflow_dispatch`, `cloudflare-worker-deploy.yml:31`) or re-run. So a commit that flips only the flags fails CI, and a hand deploy lasts only until that workflow's next deploy. Leave the binding and the namespace in place throughout: switching off deletes no grant and no token, and the binding is what keeps every revocation path below working.

1. **Immediately: deploy `main`'s head with the flag overridden.**
   - **First, disable the deploy workflow.** In Actions, open "Cloudflare Worker deploy" and choose Disable workflow, and keep it disabled until the step-2 PR is ready. This is required: while the flag is committed on, every push to `main` deploys MCP back on. Then look for a run of it that is in progress or queued, and if there is one, let it finish before you deploy. That is a further condition, not a substitute for disabling: the workflow never cancels a running deploy (`cancel-in-progress: false`, `cloudflare-worker-deploy.yml:40-42`), so a run that started before your hand deploy can finish after it and switch MCP back on, and a queued one starts after it. Until step 2 merges, do not dispatch or re-run it.
   - **Deploy.** From the repository root, on a clean checkout of `origin/main`, first install both packages as the deploy job does (`npm ci --prefix frontend` and `npm ci --prefix cloudflare-worker`, `cloudflare-worker-deploy.yml:63-67`), so the build has its dependencies and `npx wrangler` resolves the pinned wrangler rather than fetching another version for the `predeploy` migrations. Then run `npm run deploy -- --var MCP_SERVER_ENABLED:false --var WORKER_DEPLOY_VERSION:$(git rev-parse HEAD)`. The root `deploy` script runs its `predeploy` migration hook (`scripts/migrate-d1.mjs --remote`), builds, then runs `npx wrangler deploy --config ../wrangler.toml --env production` from `cloudflare-worker/`, and npm appends both `--var` flags to that command (npm 10.9.7 hands them to neither the `predeploy` nor the `postdeploy` hook). `npx --no-install wrangler deploy --help` (wrangler 4.147.0) lists `--var` as "A key-value pair to be injected into the script as a variable", repeatable; wrangler writes each over the `[vars]` value of the same name. The second flag is the one the deploy job passes on every deploy (`cloudflare-worker-deploy.yml:132`): without it the Worker would report an empty `WORKER_DEPLOY_VERSION` instead of the commit it runs. Run it from the root, not from `cloudflare-worker/`: that directory's `npm run deploy` is `cd .. && npm run deploy`, which appends the arguments without `--`, so the root npm takes each `--var` as its own option and passes the two values on to wrangler as bare arguments. The `predeploy` hook has then already applied any pending migrations and the build has run when wrangler refuses them (`Unknown argument: WORKER_DEPLOY_VERSION:<sha>`), so nothing deploys and MCP stays on. A dry run in a dummy package layout with npm 10.9.7 and wrangler 4.147.0 showed exactly that on 2026-10-14. The deploy log then lists `env.OAUTH_KV (a536c75e7461447a89b1967d367c13ad)`, `env.MCP_SERVER_ENABLED ("(hidden)")` and `env.WORKER_DEPLOY_VERSION ("(hidden)")`, because wrangler hides every `--var` value; `wrangler deploy --dry-run` with the same two flags listed exactly that on 2026-10-14. A clean checkout has no earlier build in `docs/`, so this deploy restarts asset retention ([DEPLOY.md §2.1](../operations/DEPLOY.md#21-docs-is-built-at-deploy-time-never-committed-d529)): a tab opened on an earlier build may need one reload.
   - **Confirm.** `curl -s -o /dev/null -w '%{http_code}\n' https://axal.vc/.well-known/oauth-authorization-server` answers 404 with MCP off. Run it again after any later CI deploy: until step 2 merges, a CI deploy switches MCP back on. If it answers 200, repeat this step's hand deploy, and check that the workflow is still disabled.
   - **Hand over to step 2.** Open that PR at the same time. When it is ready to merge, re-enable the workflow, so its merge deploys; merge it straight away, and confirm again once that deploy finishes.
2. **Lasting: one PR to `main` that edits three lines.** It sets `MCP_SERVER_ENABLED = "false"` in the top-level `[vars]`, sets it to `"false"` in `[env.production.vars]`, and sets `const HQ_MCP_FLAG = 'false';` in `cloudflare-worker/test/mcp_server_d666.test.ts`. CI needs nothing else: on 2026-10-14 a scratch copy with exactly those three edits passed `mcp_server_d666.test.ts`, `mcp_authorization_d669.test.ts`, `scripts/lib/branchConfig.test.mjs`, `check-wrangler-binding-parity`, `check-branch-config` and both topology tests. The same PR updates the statements that would then be false, none of which CI reads: in this section, "`MCP_SERVER_ENABLED = "true"` at the top level and in production" and the "Live since 2026-10-14 09:00:26Z" paragraph; `ROUTE_MAP.md`'s "live in production since 2026-10-14 (D681)"; and the `OAUTH_KV` row's "live since 2026-10-14" in `CODEBASE_MAP.md` §2. Each says "MCP off since <date>". Its merge deploys the Worker with MCP off.
3. **Last resort: `wrangler rollback`.** No version deployed from `main` before `710f0ae19` binds `OAUTH_KV`. The last one deployed with the flag off, `e3fb5042-82ca-4c4d-93b9-6f6ced4c8d8a` (the deploy of `7309b8a19`, run 38537160161, 08:44:28Z on 2026-10-14), lists the KV namespaces `TOKENS` and `RATE_LIMITS` only. While such a version is live, `revokeAllGrants` returns 0 without touching `OAUTH_KV` (`cloudflare-worker/src/mcp/grants.ts:105`), so no revocation path works: a member who signs out everywhere or requests deletion keeps every grant. Only `grantUser` (`grants.ts:43`) still protects them, on every tool call once MCP is back on: it refuses a grant older than the member's `jwt_min_iat` floor, and any grant of an account with `deletion_requested_at` set. Roll back only if steps 1 and 2 cannot run, as [DEPLOY.md §3](../operations/DEPLOY.md#3-capture-a-rollback-point-first) describes: `npx wrangler rollback <VERSION_ID> --config ../wrangler.toml --env production` from `cloudflare-worker/`. A rollback also takes back every other change deployed since that version, DEPLOY.md §3's D1 caveat applies, and the next CI deploy replaces it, as in step 1.

   Bring the binding back with MCP off: step 1's hand deploy with `--var MCP_SERVER_ENABLED:false`, or step 2's merge. Once that version is live, end the grants of every member who raised their session floor or requested deletion while the rollback was live, and finish those revocations before any version with the flag on goes live. Find them by what happened in that window, not by `users.deletion_requested_at`: a member's cancel (`POST /api/settings/account/delete-request/cancel`, `routes/settings.ts:934`) and HQ's close of the request (`closeDsrRequest`, `services/dsrRequests.ts:133`) both set it back to NULL. Take every `users.id` whose `jwt_min_iat` (epoch seconds) falls inside the window, and every `user_id` with an `activity_logs` row whose `action` is `'account_deletion_requested'` (`routes/settings.ts:923`) and whose `created_at` (UTC) falls inside it. `dsr_requests.requested_at` inside the window is a cross-check; it records only the first request while one is open. `jwt_min_iat` is raised by every route in the first list below, by `POST /api/settings/totp/re-enrol/confirm` after recovery (`routes/settings.ts:694`), and for every active account by HQ's `POST /api/admin/security/force-reauth` (`routes/admin_security.ts:1290`), which ends no grant itself. HQ's `POST /api/admin/security/force-reauth/:userId` ends one member's grants, and it also ends that member's sessions.

**Revoking assistant grants.** Revoke a specific grant from Account > Connectors > AI assistants (`/account/connectors#ai-assistants`, which calls `DELETE /api/connectors/assistants/:id`) before the flag goes off: with the flag off, `signedIn` in `cloudflare-worker/src/routes/mcp_consent.ts` answers 404 to that route and to the grant list. After switch-off, these still end every assistant grant a member holds, because `revokeAllGrants` (`cloudflare-worker/src/mcp/grants.ts:104`) checks only that `OAUTH_KV` is bound:

- through `bumpJwtMinIat` (`cloudflare-worker/src/auth.ts:1095`): `POST /api/auth/sign-out-everywhere` (`routes/auth.ts:1512`), `POST /api/settings/sessions/revoke-all` (`routes/settings.ts:890`), `POST /api/settings/totp/repair` (`routes/settings.ts:853`), `POST /api/settings/email-change/revoke` (`routes/settings.ts:586`) and HQ's `POST /api/admin/security/force-reauth/:userId` (`routes/admin_security.ts:1247`);
- directly: `POST /api/settings/totp/re-enrol/confirm` after recovery (`routes/settings.ts:697`) and `POST /api/settings/account/delete-request` (`routes/settings.ts:906`).

A grant older than a raised session floor is also refused on every tool call (`grants.ts:46`). A grant nobody revokes stays in `OAUTH_KV` until 30 days after its refresh token was issued or last used (`refreshTokenTTL` and `refreshTokenIdleTTL` in `cloudflare-worker/src/mcp/oauth.ts`). Turning the flag back on inside that window makes its refresh token, and any access token still inside its one-hour life, usable again.

---

## 4. Secrets checklist

### Cloudflare Worker (required)
- [ ] `JWT_SECRET` – 64+ random chars (`openssl rand -hex 48`); the worker
      refuses requests if it's missing or weak.
- [ ] `KEK_PII` – 32+ bytes; the key `services/columnCipher.ts` derives the
      column cipher from (`npx wrangler secret put KEK_PII --env=production`).
      Without it, production refuses every encrypted write: an EIN (D579), a
      bank account (D708, which answers 503 `cipher_key_missing`). Changing it
      leaves every encrypted value unreadable; each bank account then reads
      `account_unreadable` until it is retired and added again.
      D710's Mercury entity tokens are stored under it too, and read
      `token_unreadable` after a change until the Super Admin enters them again.

### Cloudflare Worker (optional, per feature)
- [ ] `GITHUB_ACCESS_TOKEN` – ticket → GitHub-issue sync.
- [ ] `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` – the GitHub connector (D655): the StudioOS GitHub App's client, with read-only issues, pull requests, contents and metadata permissions. Also settable in Admin → Integration Keys.
- [ ] `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` – outbound email.
- [ ] `STRIPE_ATLAS_API_KEY`, `STRIPE_WEBHOOK_SECRET` – spin-out incorporation.
- [ ] `STRIPE_PRICE_AI_TOPUP` – the AI top-up's price (D629, D750): the ID
      (`price_…`) of an **active, one-time, USD** price with a fixed amount, in
      the same Stripe mode as `STRIPE_SECRET_KEY` (a live key needs a live
      price). One US dollar paid buys one dollar of AI balance, credited only
      by the `payment_intent.succeeded` webhook, so `STRIPE_WEBHOOK_SECRET`
      must be set too. A price created after the last **Sync from Stripe** is
      fetched into the catalog mirror on first read (at most once per 10
      minutes per isolate); pressing Sync also clears it. Unset, or set to an
      unusable price, members see "Top-up isn't available yet." and the
      Super Admin's AI allowances screen (`GET /api/ai-budget/top-up/status`)
      says why in one sentence.
- [ ] `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET` – KYC.
- [ ] `OPENAI_API_KEY` – AI scoring fallback (Workers AI is the primary).
- [ ] `TURNSTILE_SECRET_KEY` – bot protection on register / login.
- [ ] `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET` – "Continue with Google" sign-in. Its own Web client, never mail's or the Calendar client. Google Cloud Console setup: Authorized JavaScript origins `https://axal.vc` and `https://app.axal.vc` (D722, Google's window on /login); Authorized redirect URI `https://app.axal.vc/api/auth/google/callback` (the redirect fallback); OAuth consent screen External and "In production", so gmail.com accounts can sign in. Without both secrets the button stays and a click answers "Google sign-in is not enabled on this environment."
  - `GOOGLE_SIGNIN_POPUP` is a wrangler **var**, not a secret, in both `[vars]` and `[env.production.vars]`: `"on"` lets /login open Google's own window for everyone, `"canary"` only for `/login?google_window=1`, and anything else keeps every click on the redirect and closes `POST /api/auth/google/popup` (503 `popup_off`). It ships `"off"`. After the JavaScript origins above are registered (Google says up to a few hours to take effect), set both blocks to `"canary"` in one PR, check both hosts with `?google_window=1` on Mac Safari, iPhone Safari and Chrome, then set both to `"on"`. Rollback is `"off"` and a deploy. To find the client in the Console, look for the Web client whose redirect URIs include `https://app.axal.vc/api/auth/google/callback`; Cloudflare never shows the secret's value.
- [ ] Interview channels (D684). Each provider reports itself unavailable until all of its secrets are set; none is ever committed.
  - `TELEGRAM_CHANNEL_BOT_TOKEN`, `TELEGRAM_CHANNEL_BOT_USERNAME`, `TELEGRAM_CHANNEL_WEBHOOK_SECRET` – the Telegram Business bot. It is a separate bot from `TELEGRAM_BOT_TOKEN`, and needs Business Mode switched on in @BotFather.
  - `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` – the Meta app (Tech Provider) for Embedded Signup and the Cloud API webhook.
  - `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` – the Zoom General app.
  - Google Meet uses the existing Google Calendar client (`GOOGLE_CAL_CLIENT_*`, else `GOOGLE_CLIENT_*`).
  - **Provider setup, owner-run, once each.** None of these is done by a deploy:
    - **Telegram.** `TELEGRAM_CHANNEL_WEBHOOK_SECRET` may use only `A–Z a–z 0–9 _ -`, up to 256 characters (Telegram's rule). With the three secrets set, a super admin calls `POST /api/admin/channels/telegram/webhook` once to register the webhook. After registering, a Super Admin reads `GET /api/admin/channels/telegram/webhook`, drawn as "Telegram Business bot (interviews)" on `/admin/telegram`. It should say ready: Business Mode on, the username matching, the webhook at axal.vc, the update list current and no recent delivery error. Press Register webhook again whenever `TELEGRAM_ALLOWED_UPDATES` changes. The read never shows the token or the secret (D756).
    - **Meta app.** Callback `https://axal.vc/api/channels/whatsapp/webhook`, with `WHATSAPP_VERIFY_TOKEN` as the verify token. Subscribe the fields `messages` and `smb_message_echoes`.
    - **Zoom app.** Redirect `<callback base>/api/integrations/oauth/zoom/callback`. Event endpoint `/api/channels/zoom/webhook`, for the events `meeting.ended` and `recording.transcript_completed`. The scopes are exactly the registry's three; the callback refuses a wider grant.
    - **Google Meet transcripts.** They need `meetings.space.readonly`, which no member's grant carries yet (#1577 follow-up). Scheduling a Meet call works without it.
  - **Telegram: rollout, rotation and the off switch (D756).** The full owner steps, the real-device check and these switches are in `documentation/operations/TELEGRAM.md`.
    - `TELEGRAM_CHANNEL` is a wrangler **var**, not a secret, in both `[vars]` and `[env.production.vars]`: `"off"`, `"canary"` or `"on"`; absent or anything else means `"canary"`. It ships `"canary"`: only Super Admins can link or connect. After the owner's live check passes, set both blocks to `"on"` in one PR. Rollback is `"off"` and a deploy: connected members read "Axal has switched this off for now…", and the webhook still checks its secret and acknowledges, but stores nothing. The Worker reads the var once #1950 has merged; do not set the three secrets before #1950 and #1954 (consent) are on `main`.
    - Health: after registering, the "Telegram Business bot (interviews)" section on `/admin/telegram` (`GET /api/admin/channels/telegram/webhook`, #1963) should say ready. Register the webhook again after any change to `TELEGRAM_ALLOWED_UPDATES`; the section reports the mismatch until you do.
    - Rotation: put the new `TELEGRAM_CHANNEL_WEBHOOK_SECRET`, then Register webhook at once (updates answer 401 in between, and Telegram retries). For the token, `/revoke` in @BotFather, put the new `TELEGRAM_CHANNEL_BOT_TOKEN`, then Register webhook.
    - Off without a deploy: delete `TELEGRAM_CHANNEL_WEBHOOK_SECRET`; the webhook then answers 503.

### GitHub Actions secrets
- [ ] `CLOUDFLARE_API_TOKEN` – scoped: `Workers Scripts:Edit`, `Workers KV:Edit`, `Workers AI:Read`.
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `SLACK_DEPLOY_WEBHOOK_URL` – optional, failure notifications.

---

## 5. Post-deploy checklist

- [ ] `curl https://axal.vc/api/health` returns `{ "status": "ok", ... }` with
      every binding flag (`db`, `kv_tokens`, `kv_rate_limits`,
      `durable_pipeline`, `durable_onboarding`) reading `true`.
- [ ] Sign in to `https://axal.vc/dashboard` — verify all sub-queries resolve (no 500s).
- [ ] Submit a support ticket — verify it appears in `AxalNetwork/StudioOS`.
- [ ] Trigger `POST /api/search/backfill` (admin-only) once.
- [ ] Run a manual partner-scoring job; verify `partner_scores` rows.
- [ ] Send a test email from the admin panel to verify Gmail OAuth.
- [ ] Confirm cron is firing — `wrangler tail` should show `[cron] drain` lines.

---

## 6. Rate limits (audit #8)

The worker enforces per-bucket limits via KV (`RATE_LIMITS`). FastAPI mirrors
the same layout for local-dev parity. See
`cloudflare-worker/src/services/rateLimit.ts` and
`backend/app/services/rate_limit.py`.

| Bucket    | Limit          | Scope    | Applies to                                              |
| --------- | -------------- | -------- | ------------------------------------------------------- |
| `spinout` | 5 / hour       | per user | `POST/PUT/PATCH /api/legalcap/spinout/*`                |
| `ai`      | 10 / minute    | per user | `/api/scoring/`, `/api/matches/`, `/api/advisory/`, `/api/profiling/`, `/api/monitoring/anomalies` |
| `user`    | 60 / minute    | per user | All `/api/*`                                            |
| `global`  | 1000 / minute  | global   | All `/api/*` (burst protection)                         |

Exempt: `/api/health`, `/api/auth/login|register|verify|me`, `/api/monitoring/metrics|rate-limits`.

---

## 7. Rollback

```bash
# Worker + SPA — one deployment carries the script and its [assets] bundle,
# so both hosts (axal.vc, app.axal.vc) roll back together. Run from
# cloudflare-worker/ with the production config, as DEPLOY.md §3 does.
npx wrangler deployments list --config ../wrangler.toml --env production
npx wrangler rollback <DEPLOYMENT_ID> --config ../wrangler.toml --env production

# Then revert the source on main. Reverting the docs/ commit alone changes
# nothing live: the deploy workflow rebuilds docs/ from source at deploy
# time, and the next push to main would re-ship the bad build.
git revert <SHA-of-the-source-change>
git push
```

Rollback reverts the worker (and with it the SPA), not D1 — see
[DEPLOY.md §3](../operations/DEPLOY.md#3-capture-a-rollback-point-first).
