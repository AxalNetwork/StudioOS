# Gmail API Email Setup — StudioOS

Secure email confirmations for user registration using **Gmail API** with OAuth2 authentication. Emails are sent directly from the Cloudflare Worker via the Gmail REST API.

## Architecture

```
User registers on axal.vc
    → Frontend POSTs to Cloudflare Worker (studioos.guillaumelauzier.workers.dev)
    → Worker validates Turnstile token (if configured)
    → Worker creates user in D1 + generates verification token
    → Worker exchanges OAuth2 refresh token for access token
    → Worker sends confirmation email via Gmail API (users/me/messages/send)
    → User clicks verification link → completes TOTP setup → enters dashboard
```

## Prerequisites

- A Google Cloud project (e.g., `axal-email-system`)
- A Gmail or Google Workspace account to send from

## Setup

### 1. Enable Gmail API

1. Go to **Google Cloud Console → APIs & Services → Library**
2. Search for **Gmail API**
3. Click **Enable**

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User type: **External** (or **Internal** for Workspace)
3. Fill in app name, support email
4. Add your email as a test user (if External)
5. Save

### 3. Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `StudioOS Worker`
5. Authorized redirect URIs: `https://developers.google.com/oauthplayground`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### 4. Get a Refresh Token

1. Open **https://developers.google.com/oauthplayground**
2. Click the gear icon (top right) → check **Use your own OAuth credentials**
3. Paste your **Client ID** and **Client Secret**
4. In Step 1, select scope: `https://www.googleapis.com/auth/gmail.send`
5. Click **Authorize APIs** → sign in with the Gmail account you want to send from
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token**

### 5. Set Worker Secrets

```bash
cd cloudflare-worker
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

Or with explicit Worker name:

```bash
npx wrangler secret put GMAIL_CLIENT_ID --name studioos
npx wrangler secret put GMAIL_CLIENT_SECRET --name studioos
npx wrangler secret put GMAIL_REFRESH_TOKEN --name studioos
```

### 6. Deploy

```bash
npm run deploy
```

### 7. Verify

```bash
curl https://studioos.guillaumelauzier.workers.dev/api/health
```

You should see:
```json
"gmail": true
```

## How It Works

### OAuth2 Token Exchange

The Worker uses the stored refresh token to obtain a short-lived access token from Google's OAuth2 endpoint (`https://oauth2.googleapis.com/token`). This access token is used to authenticate the Gmail API request.

### Email Flow

1. Worker generates a verification token, hashes it (SHA-256), stores the hash in D1
2. Constructs a branded HTML email with the verification link
3. Builds RFC-compliant MIME message with multipart/alternative (text + HTML)
4. Base64url-encodes the raw MIME content
5. Sends via Gmail API `POST /gmail/v1/users/me/messages/send`
6. User clicks link → Worker verifies token hash → marks email as verified

### Security Measures

- **Verification tokens** are SHA-256 hashed in the database — raw tokens only exist in the email link
- **Tokens expire** after 24 hours
- **Rate limiting** on resend-verification (max 3/hour per email) via KV
- **Turnstile** bot protection on registration (optional but recommended)
- **No secrets in logs** — verification URLs are never logged
- **CORS** restricted to `axal.vc` and `www.axal.vc`
- **Gmail credentials** stored as Worker secrets, never exposed in code or health endpoint

## Local Testing

```bash
cd cloudflare-worker

# Start local dev server (D1 uses local SQLite)
npm run dev

# In another terminal, test registration:
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","role":"partner"}'
```

Note: Gmail API works in local dev if the secrets are set in a `.dev.vars` file:

```
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
```

## File Reference

| File | Purpose |
|------|---------|
| `wrangler.toml` | Worker config with D1, KV bindings |
| `src/services/email.ts` | Gmail API email service (OAuth2 token exchange + MIME construction) |
| `src/services/turnstile.ts` | Cloudflare Turnstile verification |
| `src/routes/auth.ts` | Registration, verification, TOTP setup, login |
| `src/types.ts` | TypeScript env interface with GMAIL_* secrets |
| `sql/schema.sql` | D1 database schema |
