# Cloudflare Worker — Secret Setup

The Worker reads every secret from the runtime environment via the `Env`
interface (`cloudflare-worker/src/types.ts`). Nothing is hardcoded in the
source. Set each secret with `wrangler secret put NAME` from the
**repository root** (the canonical `wrangler.toml` lives there).

Public, non-secret values (account ID, D1 ID, KV namespace IDs, public
Turnstile site key) live in `wrangler.toml` and `frontend/.env.example`
and are safe to commit.

## Required secrets (production)

| Name                     | Used by                                      | Notes |
|--------------------------|----------------------------------------------|-------|
| `JWT_SECRET`             | `auth.ts`, `scoreIntegrity.ts` (fallback)    | ≥32 bytes in prod (boot guard). `openssl rand -hex 48`. |
| `SCORING_HMAC_SECRET`    | `services/scoreIntegrity.ts`                 | Optional; falls back to `JWT_SECRET`. ≥16 bytes. **Refuses to sign without it** (no more dev fallback). |
| `TURNSTILE_SECRET_KEY`   | `services/turnstile.ts`                      | Bot protection. Fails-open with a warning if unset. |
| `GMAIL_CLIENT_ID`        | `services/email.ts`                          | OAuth2 client for outbound email. |
| `GMAIL_CLIENT_SECRET`    | `services/email.ts`                          | "" |
| `GMAIL_REFRESH_TOKEN`    | `services/email.ts`                          | "" |
| `GITHUB_ACCESS_TOKEN`    | `services/github.ts`, `routes/tickets.ts`    | Fine-grained PAT, `Issues: Read & write`. |

## Optional secrets (feature-gated)

| Name                     | Used by                                      | Behavior when unset |
|--------------------------|----------------------------------------------|---------------------|
| `OPENAI_API_KEY`         | AI fallback in `services/ai.ts`              | Falls back to Workers AI. |
| `STRIPE_SECRET_KEY`      | `routes/billing.ts` (mi-pro tier)            | `/checkout` returns dev URL → `/dev-upgrade`. |
| `STRIPE_WEBHOOK_SECRET`  | `routes/billing.ts`                          | Webhook signature check is skipped (dev only). |
| `STRIPE_ATLAS_API_KEY`   | `routes/legalcap.ts`                         | Atlas calls stub a `mock_atlas_*` ref. |
| `SUMSUB_API_KEY`         | `routes/integrations.ts`                     | KYC provider integration disabled. |
| `PERSONA_API_KEY`        | `routes/integrations.ts`                     | KYC provider integration disabled. |
| `FASTAPI_ORIGIN`         | `index.ts` proxy handler                     | Proxy returns 503 (FastAPI is dev-only). |

## Public (non-secret) Worker vars

Already in `wrangler.toml`, no `wrangler secret put` needed:
`APP_URL`, `ENVIRONMENT`, `USE_CF_QUEUE`, `GITHUB_REPO_OWNER`,
`GITHUB_REPO_NAME`. The frontend's `VITE_TURNSTILE_SITE_KEY` is also
public — it ships in the JS bundle by design.

## Apply to production

```bash
# from repo root (where wrangler.toml lives)

npx wrangler secret put JWT_SECRET
npx wrangler secret put SCORING_HMAC_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
npx wrangler secret put GITHUB_ACCESS_TOKEN

# Optional, only if the feature is enabled in prod:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_ATLAS_API_KEY
npx wrangler secret put SUMSUB_API_KEY
npx wrangler secret put PERSONA_API_KEY
```

If Wrangler can't auto-detect the project, append `--name studioos`.

## Apply to preview / staging

The `[env.preview]` block in `wrangler.toml` is currently commented out.
Once you uncomment it (after creating the preview D1 + KV namespaces),
add `--env preview` to every command above:

```bash
npx wrangler secret put JWT_SECRET           --env preview
npx wrangler secret put SCORING_HMAC_SECRET  --env preview
npx wrangler secret put TURNSTILE_SECRET_KEY --env preview
npx wrangler secret put GMAIL_CLIENT_ID      --env preview
npx wrangler secret put GMAIL_CLIENT_SECRET  --env preview
npx wrangler secret put GMAIL_REFRESH_TOKEN  --env preview
npx wrangler secret put GITHUB_ACCESS_TOKEN  --env preview
# …and the optional ones if needed.
```

## Verify

```bash
npx wrangler secret list                # production
npx wrangler secret list --env preview  # staging
curl https://studioos.guillaumelauzier.workers.dev/api/health
# expect: "gmail": true, "turnstile": true, etc.
```

## Local dev

The FastAPI backend reads the same names from `.env` (template:
`.env.example` at repo root). Both `JWT_SECRET` and (optionally)
`SCORING_HMAC_SECRET` are now required in dev too — score-signing no
longer falls back to a hardcoded constant.

## Rotation

Rotate by re-running `wrangler secret put` with a new value. Existing
JWTs remain valid until expiry; force-revoke by bumping
`users.jwt_min_iat` (admin endpoint). Score signatures stay verifiable
across rotation only if you keep the old `SCORING_HMAC_SECRET` around
in `OLD_SCORING_HMAC_SECRET` (not yet wired) — for now, plan rotation
during a low-traffic window and accept that the nightly hash audit will
flag pre-rotation snapshots as `missing_hash` until re-signed.
