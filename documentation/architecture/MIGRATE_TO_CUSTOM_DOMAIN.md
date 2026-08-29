# Migrate Production to `app.axal.vc`

**Status:** ⚠️ In progress — Cloudflare + code landed, operator deploy + OAuth provider updates pending.
**Owner:** Infra.
**Last update:** Task #36, 2026-05-20 — switched architecture from
"Pages SPA + path-scoped worker route" to "Worker serves both SPA
and API via Workers Static Assets + Workers Custom Domain"; bound
custom domain, disabled workers.dev, deleted legacy apex route.

This is the cutover runbook for moving the production SPA + API off
`*.workers.dev` onto the dedicated subdomain `app.axal.vc`, while the
brand apex `axal.vc` continues to serve the GitHub Pages marketing
site.

## Target architecture (Task #36)

The `studioos` worker now serves **both** the SPA (Workers Static
Assets, `frontend/dist`) and the `/api/*` routes on a single
hostname. No Cloudflare Pages project is involved.

| Hostname             | Served by                                | Notes |
|----------------------|------------------------------------------|-------|
| `axal.vc`            | GitHub Pages (marketing)                 | **NEVER** attach Cloudflare custom domain; apex DNS stays DNS-only. |
| `www.axal.vc`        | GitHub Pages (marketing)                 | Redirect-to-apex or duplicate site. |
| `app.axal.vc`        | Cloudflare Worker (`studioos`) — both SPA assets and `/api/*` | Same-origin SPA + API on one worker. Workers Custom Domain binding (not a zone route). |
| `cdn.axal.vc`        | R2 public bucket (optional)              | Reserved. |
| `status.axal.vc`     | Worker (status page HTML)                | Public, allowed in CORS allowlist. |
| `backup.app.axal.vc` | GitHub Pages SPA failover                | Reserved. |
| `*.workers.dev`      | **Disabled** for `studioos`              | `workers_dev = false`; the workers.dev URL returns 404 at the edge. Preview env (`studioos-preview`) still uses workers.dev. |

## Code/config changes landed

- `wrangler.toml` (Task #36) — top-level and `[env.production]`:
  `workers_dev = false`; `[[routes]]` replaced with
  `pattern = "app.axal.vc", custom_domain = true`; new `[assets]`
  block pointing at `./docs` (Vite's existing outDir) with
  `not_found_handling = "single-page-application"` and
  `run_worker_first = ["/api/*", "/landing/*"]` so the SPA fallback
  doesn't swallow the worker's API + landing routes.
  `[env.preview]` retains `workers_dev = true` for PR preview
  deploys.
- `wrangler.toml` (Task #30) — `APP_URL`, `PUBLIC_BASE_URL`,
  `PUBLIC_MARKETING_URL` set to the new hosts.
- `cloudflare-worker/src/index.ts` — CORS prod allowlist expanded to
  `app.axal.vc`, `axal.vc`, `www.axal.vc`, `status.axal.vc`. Existing
  410-Gone guard on workers.dev OAuth callbacks now references
  `app.axal.vc` in its user-visible message.
- `cloudflare-worker/src/middleware/securityHeaders.ts` — CSP
  `connect-src` widened to include `app.axal.vc`, `api.stripe.com`,
  `*.cloudflareaccess.com`.
- `cloudflare-worker/src/types.ts` — declared `PUBLIC_BASE_URL` +
  `PUBLIC_MARKETING_URL` on `Env`.
- `frontend/src/lib/api.js` — already uses relative `/api` (no change
  needed).
- `frontend/.env.example` — `VITE_API_URL` documented as same-origin
  default; no longer references workers.dev.
- Docs updated: `SECURITY.md`, `README.md`, `replit.md`.

> Code reads `c.env.APP_URL` in dozens of places (email templates,
> OAuth redirect URI builders, signed-download URL signer, Stripe
> success/cancel URLs, sitemap, openapi.json server entry). Because
> `APP_URL` itself is now `https://app.axal.vc`, all those derived
> URLs migrate automatically the moment a `wrangler deploy` ships.
> No additional code edits are required for the URL migration —
> only the operator-only DNS / provider / dashboard steps below.

---

## Done by Task #36 (no operator action needed)

- ✅ Workers Custom Domain `app.axal.vc` bound to `studioos`
  (domain id `99a948c3a0520387cbebeaeb62ecbe692e5cc648`, cert id
  `87e2318c-44a8-49cd-8832-9e1979de0739`).
- ✅ Proxied `AAAA app.axal.vc → 100::` record auto-created by
  Cloudflare (origin_worker_id stamped, read_only).
- ✅ `workers.dev` subdomain disabled for `studioos`
  (`enabled: false`). The `studioos.guillaumelauzier.workers.dev`
  URL now returns 404 at the edge.
- ✅ Legacy zone route `axal.vc/api/*` deleted (the apex no longer
  routes any path to the worker; GitHub Pages owns the apex
  entirely).

## Operator-only steps (still pending)

### 1. Cloudflare DNS (zone `axal.vc`)

These are unrelated to the cutover proper — leave the apex GitHub
Pages records alone and only add the ones you actually need.

- [x] **`app.axal.vc`** — auto-created by the Workers Custom Domain
  binding (proxied AAAA). No manual record needed.
- [ ] **`cdn.axal.vc`** — Add `CNAME` → R2 public-bucket target.
  Proxied. **Optional** — only if R2 public access stays enabled.
  The ops backlog says to disable R2 public access; if so, skip.
- [ ] **`status.axal.vc`** — Add `CNAME` → `app.axal.vc`. Proxied.
- [ ] **`backup.app.axal.vc`** — Add `CNAME` → `axalnetwork.github.io`.
  **DNS only (grey cloud)** — GitHub Pages won't issue TLS through CF
  proxy on this hostname.

### 2. Cloudflare dashboard verification

- [ ] **Workers → `studioos` → Triggers** — confirm `app.axal.vc`
  appears as a Custom Domain (not a Route). Should already be
  there from the Task #36 API call.
- [ ] **SSL/TLS → Overview** — set the zone to **Full (strict)**.
- [ ] **Access policies** — re-apply admin/monitoring/infra Access
  policies on `app.axal.vc/api/admin/*` and any other previously
  Access-protected paths (Task #33 perimeter).

### 3. Build + deploy (REQUIRED before SPA loads)

Until the first deploy with the new `[assets]` binding lands,
`https://app.axal.vc/` returns 404 for any non-`/api/*` path
(custom domain is live but the worker has no asset bundle yet).

- [ ] `cd frontend && npm run build` — writes to repo-root `./docs/`
  (Vite outDir set in `frontend/vite.config.js`).
- [ ] `npx wrangler deploy --env production` — uploads the worker
  AND the static asset bundle in one call. Wrangler will report
  the asset count and the upload size.
- [ ] Re-confirm production secrets are present on the production
  worker: `JWT_SECRET`, `SCORING_HMAC_SECRET`, `AXAL_ENCRYPTION_SECRET`,
  `TURNSTILE_SECRET_KEY`, `STRIPE_*`, `GOOGLE_CLIENT_*`,
  `MICROSOFT_CLIENT_*`, `LINKEDIN_CLIENT_*`, etc. (`wrangler secret list
  --env production`).
- [ ] (Operator-only) The Replit env ships Node 20; wrangler requires
  Node 22+. Use the Node 22 binary at
  `/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin`
  via `export PATH=…/bin:$PATH` before running wrangler from this
  env. CI uses Node 22 by default.

### 4. OAuth provider redirect URIs

For each provider: **ADD the new `app.axal.vc/...` URL first, deploy,
verify end-to-end, THEN remove the old workers.dev / axal.vc URL.**
Never delete the old URI before confirming the new one round-trips.

| Provider             | Console                          | New redirect URI(s)                                       | Cutover ts | Verified by |
|----------------------|----------------------------------|-----------------------------------------------------------|------------|-------------|
| Google Cloud (Calendar + OAuth) | Google Cloud Console → Credentials → OAuth client | `https://app.axal.vc/api/calendar/google/callback` + JS origin `https://app.axal.vc` | _pending_ | _pending_ |
| Microsoft Entra (Outlook Calendar) | Entra admin → App registrations | `https://app.axal.vc/api/calendar/microsoft/callback`     | _pending_ | _pending_ |
| LinkedIn             | LinkedIn Developer Portal        | `https://app.axal.vc/api/linkedin/oauth/callback`         | _pending_ | _pending_ |
| Stripe Connect       | Stripe Dashboard → Connect → Settings | Return/refresh URLs at `https://app.axal.vc/connect/return` + `/connect/refresh` | _pending_ | _pending_ |
| HubSpot              | HubSpot Developer (marketplace app) | `https://app.axal.vc/api/integrations/hubspot/oauth/callback` (PAT users: no change) | _pending_ | _pending_ |
| Salesforce           | SF Connected App                 | `https://app.axal.vc/api/integrations/salesforce/oauth/callback` | _pending_ | _pending_ |
| Carta                | Carta partner portal             | `https://app.axal.vc/api/integrations/carta/oauth/callback` | _pending_ | _pending_ |
| Calendly             | Calendly Developer dashboard     | `https://app.axal.vc/api/integrations/calendly/oauth/callback` (PAT users: no change) | _pending_ | _pending_ |
| Slack                | Slack API → App → OAuth          | `https://app.axal.vc/api/integrations/slack/oauth/callback` | _pending_ | _pending_ |
| DocuSign             | DocuSign Apps & Keys             | `https://app.axal.vc/api/integrations/docusign/oauth/callback` | _pending_ | _pending_ |
| Persona              | Persona Dashboard                | `https://app.axal.vc/api/integrations/persona/oauth/callback` | _pending_ | _pending_ |
| Affinity             | (token-based, no redirect)       | n/a                                                       | n/a        | n/a |

### 5. Webhook receivers

Update each provider's webhook destination to the new `app.axal.vc`
URL. **Rotate the Sumsub signing secret while you're in there** —
the spec calls this out explicitly.

| Provider     | New webhook URL                                                       | Secret rotated | Cutover ts |
|--------------|-----------------------------------------------------------------------|----------------|------------|
| Stripe       | `https://app.axal.vc/api/integrations/stripe/webhook`                 | n/a            | _pending_  |
| Persona      | `https://app.axal.vc/api/integrations/persona/webhook`                | n/a            | _pending_  |
| Sumsub       | `https://app.axal.vc/api/integrations/sumsub/webhook`                 | **YES — rotate** | _pending_  |
| HubSpot      | `https://app.axal.vc/api/integrations/hubspot/webhook`                | n/a            | _pending_  |
| Salesforce   | `https://app.axal.vc/api/integrations/salesforce/webhook`             | n/a            | _pending_  |
| Calendly     | `https://app.axal.vc/api/integrations/calendly/webhook`               | n/a            | _pending_  |
| Slack Events | `https://app.axal.vc/api/customer-chat/slack-reply`                   | n/a            | _pending_  |
| DocuSign Connect | `https://app.axal.vc/api/integrations/docusign/webhook`           | n/a            | _pending_  |
| Affinity     | `https://app.axal.vc/api/integrations/affinity/webhook`               | n/a            | _pending_  |
| GitHub       | `https://app.axal.vc/api/forms/github-webhook`                        | n/a            | _pending_  |
| Google Calendar push | `https://app.axal.vc/api/calendar/google/push`                | n/a            | _pending_  |
| Outlook notification | `https://app.axal.vc/api/calendar/outlook/notification`       | n/a            | _pending_  |

### 6. Email auth + deliverability

Publish on the `axal.vc` zone (TXT records). Aim for ≥ 9/10 at
mail-tester.com after publishing.

- [ ] **SPF** — `v=spf1 include:<provider> -all` (replace `<provider>`
  with whichever ESP is actually sending — likely `_spf.google.com`
  if Gmail relay; check `services/email/send.ts` for the current
  provider).
- [ ] **DKIM** — per-provider DKIM TXT records as documented by the
  ESP. Selector name varies by provider.
- [ ] **DMARC** — `_dmarc.axal.vc` TXT
  `v=DMARC1; p=reject; rua=mailto:dmarc@axal.vc; ruf=mailto:dmarc@axal.vc; fo=1; pct=100`.
- [ ] Keep MX records consistent — do not touch them during this
  migration.
- [ ] After publishing, send a test email to `mail-tester.com` and
  paste the score below.

  **Score:** _pending_  /10

### 7. Cross-origin marketing forms (Jekyll → Worker)

The marketing site (`axal.vc`, GitHub Pages) needs to POST to
`https://app.axal.vc/api/forms/*`. The CORS allowlist already
includes `https://axal.vc` after this branch. The marketing-site JS
must use `credentials: 'omit'` (no auth cookies cross-origin) and
include the Turnstile token in the body. **Worker-side Turnstile
verification is already wired** in `services/turnstile.ts`.

- [ ] Update Jekyll marketing site contact form JS to post to
  `https://app.axal.vc/api/forms/contact` (or whichever route is in
  use) with `credentials: 'omit'`.
- [ ] Update marketing-site CSP (in Jekyll `<head>`) to allow
  `connect-src https://app.axal.vc`.

### 8. Smoke test (after cutover)

Run each of these and tick before declaring the migration complete.

- [ ] `https://axal.vc` still loads from GitHub Pages, untouched.
- [ ] `https://app.axal.vc` loads the SPA (Pages).
- [ ] `https://app.axal.vc/api/health` returns the worker health JSON
  (200).
- [ ] Magic-link sign-up end-to-end (request, click email link, land
  authenticated).
- [ ] Google Calendar connect end-to-end (consent → callback →
  `/calendar?google=connected`).
- [ ] Stripe Connect round-trip (onboarding link → return → status
  reflects connected).
- [ ] Calendly webhook firing (book a slot in a test Calendly
  account, verify worker log entry).
- [ ] Marketing-site contact form POST from `https://axal.vc` →
  worker returns 200, Turnstile validated.
- [ ] [securityheaders.com](https://securityheaders.com/) grade A+
  on `https://app.axal.vc`.
- [ ] `curl https://studioos.guillaumelauzier.workers.dev/api/health`
  returns 404 (workers.dev subdomain disabled by Task #36).
- [ ] `grep -rn "workers.dev" cloudflare-worker frontend` shows hits
  only inside `[env.preview]` blocks and code comments — no
  production code paths.

### 9. Rollback path

If `app.axal.vc` breaks after deploy:

1. **Re-enable workers.dev** as a temporary escape hatch:
   ```
   curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/studioos/subdomain" \
     -d '{"enabled":true}'
   ```
   (and flip `workers_dev = true` in `wrangler.toml`).
2. **Unbind the custom domain** (Cloudflare dashboard → Workers →
   `studioos` → Triggers → remove `app.axal.vc`, OR DELETE via the
   Workers domains API using domain id
   `99a948c3a0520387cbebeaeb62ecbe692e5cc648`).
3. **Re-add the apex zone route** if you want the worker reachable
   under `axal.vc/api/*` again (PUT `/zones/{zone_id}/workers/routes`
   with `pattern: "axal.vc/api/*", script: "studioos"`).
4. Revert the Task #36 `wrangler.toml` commit and redeploy.

---

## Sign-off

When every box above is ticked, change the status header at the top
of this file from "⚠️ In progress" to "✅ Complete — YYYY-MM-DD" and
commit. Leave the file in the repo — it's the audit trail for the
cutover.
