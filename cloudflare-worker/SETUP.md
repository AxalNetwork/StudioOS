# StudioOS — Cloudflare Worker Deployment Guide

Complete step-by-step instructions to deploy the Axal VC StudioOS API on Cloudflare Workers.

---

## Prerequisites

- Node.js 18+ and npm installed
- A Cloudflare account (free tier works)
- A Google Cloud project with Gmail API enabled (for sending verification emails)

---

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

---

## Step 2: Install Worker Dependencies

```bash
cd cloudflare-worker
npm install
```

---

## Step 3: Create KV Namespaces

```bash
npx wrangler kv:namespace create "TOKENS"
npx wrangler kv:namespace create "RATE_LIMITS"
```

Copy the returned IDs and paste them into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TOKENS"
id = "<paste TOKENS ID here>"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<paste RATE_LIMITS ID here>"
```

---

## Step 4: Create D1 Database

```bash
npx wrangler d1 create studioos-db
```

Copy the returned database ID and paste into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "studioos-db"
database_id = "<paste D1 database ID here>"
```

---

## Step 5: Apply Database Schema

```bash
npm run db:schema:remote
```

This applies `sql/schema.sql` to the live D1 database.

---

## Step 6: Set Up Gmail API for Email

See `EMAIL-SETUP.md` for detailed Gmail API configuration instructions.

Required secrets:

```bash
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

---

## Step 7: Set Other Secrets

```bash
npx wrangler secret put JWT_SECRET
# Paste a strong random string (e.g., openssl rand -hex 32)
```

Optional secrets:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
# Cloudflare Turnstile secret key (for bot protection on registration)

npx wrangler secret put OPENAI_API_KEY
# Only needed for AI-powered advisory responses

npx wrangler secret put GITHUB_ACCESS_TOKEN
# Only needed for GitHub ticket sync
```

---

## Step 8: Configure Environment Variables

Edit the `[vars]` section in `wrangler.toml`:

```toml
[vars]
APP_URL = "https://axal.vc"
GITHUB_REPO_OWNER = "AxalNetwork"
GITHUB_REPO_NAME = "StudioOS"
```

---

## Step 9: Deploy

```bash
npx wrangler deploy
```

Your API is now live at: `https://studioos.guillaumelauzier.workers.dev`

---

## Step 10: (Optional) Cloudflare Turnstile

1. Go to **Cloudflare Dashboard → Turnstile**
2. Add a site for `axal.vc`
3. Copy **Site Key** → set as `VITE_TURNSTILE_SITE_KEY` in frontend build
4. Copy **Secret Key** → set via `npx wrangler secret put TURNSTILE_SECRET_KEY`

---

## Step 11: (Optional) Custom Domain

```bash
npx wrangler domains add api.axal.vc
```

Or configure via Cloudflare Dashboard → Workers → your worker → Settings → Domains & Routes.

---

## Architecture

```
Cloudflare Workers (Edge)
├── Hono (Router + Middleware)
├── JWT Auth (jose)
├── TOTP 2FA (otpauth)
├── Email (Gmail API OAuth2)
├── Turnstile (bot protection)
├── KV: TOKENS (verification tokens)
├── KV: RATE_LIMITS (login/resend throttling)
└── D1 (SQLite at the edge)
```

---

## Troubleshooting

- **"Too many subrequests"**: Cloudflare Workers have a 50-subrequest limit per request. The D1 driver uses one subrequest per query. Complex endpoints may hit this — optimize by combining queries.
- **KV eventually consistent**: KV writes may take up to 60 seconds to propagate globally. Rate limiting is best-effort.
- **Email not sending**: Ensure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` are set as Worker secrets. Check Worker Logs in the Cloudflare Dashboard.
- **Gmail OAuth token expired**: Refresh tokens are long-lived but can be revoked. Re-authorize via OAuth Playground if needed.
