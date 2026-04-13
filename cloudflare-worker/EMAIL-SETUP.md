# Cloudflare Email Setup — StudioOS

Secure email confirmations for user registration using **Cloudflare Email Routing** with the native `send_email` Worker binding. No third-party email service required.

## Architecture

```
User registers on axal.vc
    → Frontend POSTs to Cloudflare Worker (studioos.guillaumelauzier.workers.dev)
    → Worker validates Turnstile token (if configured)
    → Worker creates user in D1 + generates verification token
    → Worker sends confirmation email via send_email binding (Cloudflare Email Routing)
    → User clicks verification link → completes TOTP setup → enters dashboard
```

## Prerequisites

- `axal.vc` domain on Cloudflare (DNS managed by Cloudflare)
- Cloudflare Workers plan (Free or Paid)
- Email Routing enabled on the domain

## Setup Checklist

### 1. Enable Email Routing on axal.vc

1. Go to **Cloudflare Dashboard → axal.vc → Email → Email Routing**
2. Click **Get started** or **Enable Email Routing**
3. Cloudflare will prompt you to add required DNS records:
   - **MX records** pointing to Cloudflare's email servers
   - **SPF TXT record** for email authentication
4. Accept the DNS changes and wait for propagation

### 2. Add and Verify Destination Address

1. In **Email Routing → Destination addresses**, click **Add destination address**
2. Enter the email where you want to receive forwarded mail (e.g., your Gmail)
3. Check that inbox for a verification email from Cloudflare and click the confirmation link
4. The address should show as **Verified**

### 3. Create a Custom Address Route

1. In **Email Routing → Custom addresses**, click **Create address**
2. Set:
   - **Custom address**: `noreply`
   - **Action**: Send to an email
   - **Destination**: your verified destination email
3. Save — this creates `noreply@axal.vc`

### 4. Deploy the Worker

```bash
cd cloudflare-worker

# Set required secrets
npx wrangler secret put JWT_SECRET
# Enter a strong random string (e.g., openssl rand -hex 32)

# Optional: Set Turnstile secret for bot protection
npx wrangler secret put TURNSTILE_SECRET_KEY
# Get this from Cloudflare Dashboard → Turnstile → your site → Secret Key

# Deploy
npm run deploy
```

### 5. Apply Database Schema (first time only)

```bash
npm run db:schema:remote
```

### 6. (Optional) Set Up Cloudflare Turnstile

1. Go to **Cloudflare Dashboard → Turnstile**
2. Click **Add site**
3. Configure:
   - **Site name**: Axal VC StudioOS
   - **Domain**: axal.vc
   - **Widget type**: Managed (recommended)
4. Copy the **Site Key** → set as `VITE_TURNSTILE_SITE_KEY` in frontend build
5. Copy the **Secret Key** → set via `npx wrangler secret put TURNSTILE_SECRET_KEY`
6. Rebuild frontend: `cd frontend && npx vite build`

## How It Works

### send_email Binding

The Worker uses Cloudflare's native `send_email` binding declared in `wrangler.toml`:

```toml
[[send_email]]
name = "SEND_EMAIL"
```

This binding provides the `SendEmail` interface, which accepts an `EmailMessage` constructed from raw MIME content. The `mimetext` package builds RFC-compliant MIME messages with HTML and plain text parts.

### Email Flow

1. Worker generates a verification token, hashes it (SHA-256), stores the hash in D1
2. Constructs a branded HTML email with the verification link
3. Builds MIME message using `mimetext`
4. Sends via `env.SEND_EMAIL.send(new EmailMessage(from, to, rawMime))`
5. User clicks link → Worker verifies token hash → marks email as verified

### Security Measures

- **Verification tokens** are SHA-256 hashed in the database — raw tokens only exist in the email link
- **Tokens expire** after 24 hours
- **Rate limiting** on resend-verification (max 3/hour per email) via KV
- **Turnstile** bot protection on registration (optional but recommended)
- **No secrets in logs** — verification URLs are never logged
- **CORS** restricted to `axal.vc` and `www.axal.vc`

## Important Limitations

1. **Email Routing must be enabled** on the domain in Cloudflare Dashboard
2. **Sender address** (`noreply@axal.vc`) must be configured as a custom address in Email Routing
3. **MX records** must point to Cloudflare — if you have existing email (e.g., Google Workspace), you need to configure Email Routing to coexist with your existing MX setup
4. **Deliverability** depends on proper SPF/DKIM/DMARC records on the domain
5. If the `SEND_EMAIL` binding is not configured, the Worker logs a warning and registration still succeeds (email just won't be sent)

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

Note: `send_email` binding is **not available in local dev** (`wrangler dev`). The Worker will log a warning and skip email sending. Check Worker Logs in the Cloudflare Dashboard after deploying to production to verify emails are being sent.

## File Reference

| File | Purpose |
|------|---------|
| `wrangler.toml` | Worker config with send_email, D1, KV bindings |
| `src/services/email.ts` | Email sending via Cloudflare EmailMessage + mimetext |
| `src/services/turnstile.ts` | Cloudflare Turnstile verification |
| `src/routes/auth.ts` | Registration, verification, TOTP setup, login |
| `src/types.ts` | TypeScript env interface with SEND_EMAIL binding |
| `sql/schema.sql` | D1 database schema |

## DNS Records Checklist

After enabling Email Routing, verify these records exist on axal.vc:

| Type | Name | Content | Priority |
|------|------|---------|----------|
| MX | axal.vc | `route1.mx.cloudflare.net` | 69 |
| MX | axal.vc | `route2.mx.cloudflare.net` | 36 |
| MX | axal.vc | `route3.mx.cloudflare.net` | 90 |
| TXT | axal.vc | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — |

If you already have MX records (e.g., Google Workspace), see [Cloudflare Email Routing docs](https://developers.cloudflare.com/email-routing/) for coexistence setup.
