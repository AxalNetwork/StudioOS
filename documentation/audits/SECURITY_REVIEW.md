# StudioOS — Security Review (Task #33)

_Last updated: 2026-05-09._
_Owner: Platform / Security._
_Status: foundation landed. Items marked **OPEN** are tracked as follow-ups._

This document is the audit + design record for the security hardening
foundation. It is the source of truth for required Wrangler secrets,
encryption design choices, and the threat-model assumptions every later
workstream (#34–#38) builds on.

---

## 1. Audit findings — fixed in this task

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | TOTP secrets stored in `users.password_hash` (a column reused for the wrong purpose). Any read path that treated `password_hash` as a credential hash was operating on the second factor instead. | **HIGH** | New `auth_totp` table holds AES-GCM ciphertext of the secret (AAD-bound). Lazy migration on first login moves legacy users off `password_hash` AND sets `users.password_reset_required = 1` so the next login surfaces the recovery flow. New enrolments never touch `password_hash`. |
| F2 | No column-level encryption for PII / financial / cap-table data. Raw-SQL access to D1 was equivalent to plaintext access. | **HIGH** | New `services/columnCipher.ts` — AES-256-GCM, 12-byte nonce, 16-byte tag, AAD = `table:column:rowId`. Versioned ciphertext (`v1.<b64url>`). Deterministic HMAC index helper for equality lookups. Master key `KEK_PII` (≥32 bytes), HKDF-derived per use. |
| F3 | Signed contracts in R2 had no minted-URL primitive. Worker-streamed download was implemented per-route (esign), but no general "give the admin a 5-minute one-shot link" path existed. | **MEDIUM** | New `services/signedDownload.ts` + `routes/files.ts` mount signed download URLs at `/api/files/dl/:token`. TTL hard-clamped to 5 minutes. Single-use is **best-effort** (KV get→delete is not CAS — see §3.1). Every download writes to `activity_logs` so duplicate consumption is detectable post-hoc. Admin contracts (`routes/admin_contracts.ts:/:uid/download` + `/:uid/download-url`) now mint via this primitive instead of returning 501 stubs — the R2 `file_key` is gated through a regex allowlist (`contracts/`, `esign/`, `documents/` prefixes only) before tokenisation. **OPEN**: back with a Durable Object if strictly-once semantics are ever required. |
| F4 | Admin / monitoring / infra routes had no perimeter beyond JWT. A leaked admin JWT was a full breach. | **HIGH** | New `middleware/cfAccess.ts` verifies `Cf-Access-Jwt-Assertion` against the team JWKS. Engaged when `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` are set; soft no-op in dev/preview. Wired on `/api/admin/*`, `/api/monitoring/*`, `/api/infra/*`. **OPEN**: Cloudflare-side Access app + policies must be provisioned by the operator before this engages (see §6). |
| F5 | Permissions-Policy whitelisted nothing but the original four sensors. Newer features (USB / serial / HID / etc.) were unconstrained. | **LOW** | Header now denies geolocation, camera, microphone, payment, usb, bluetooth, accelerometer, gyroscope, magnetometer, midi, serial, hid, interest-cohort by default. |
| F6 | No COOP. window.opener-style attacks could in principle peek at API responses opened in a popup. | **LOW** | `Cross-Origin-Opener-Policy: same-origin` added. |
| F7 | JWT alg pinning not explicit at the call site. | **LOW** | `auth.ts` already passes `algorithms: [JWT_ALGORITHM]` (HS256) to `jwtVerify`; documented in §4 below. `none` and `RS*` are rejected at decode time. |
| F8 | Stripe webhook signature compare was hand-rolled. | **AUDIT** | Reviewed `verifyStripeSignature` in `routes/billing.ts:284` — uses HMAC-SHA256 over `${t}.${body}` and a constant-time comparator (`diff |= ...`). Rejects when `STRIPE_WEBHOOK_SECRET` is set but the header is missing/invalid. **OPEN**: dev / preview accepts unsigned bodies (no secret set) — fine for local Stripe CLI but means a misconfigured prod (no secret) would silently accept any payload. The boot-time secret check in §6 is the long-term mitigation. |

---

## 2. Audit findings — tracked as follow-ups

These were in the broader task brief but are deferred to future work
(some require migrations against live data; others are downstream tasks
already on the roadmap).

| # | Finding | Why deferred | Tracking |
|---|---|---|---|
| O1 | Backfill PII columns (email, phone, address, DOB, SSN/tax ID) to ciphertext + drain plaintext within 7 days. | Requires per-table column-add migration + dual-read shims; touches every PII-emitting endpoint. Foundation primitives shipped here unblock that work. | **OPEN**, post-#33 follow-up. |
| O2 | Move session JWT from localStorage to httpOnly cookie globally. | Cookie + CSRF infrastructure (`setAuthCookies`, `csrfMiddleware`) already shipped under T6; legacy callers (impersonation, websocket subprotocol, signed-download URLs) deliberately keep Bearer flow. Full eviction is a separate UI-side cleanup. | Tracked in T6 follow-up notes. |
| O3 | Tail-worker → R2 object-lock (compliance mode, 7y retention) for admin audit-log forwarding. | Requires Cloudflare side to provision the tail-worker binding + R2 retention policy. Existing `activity_logs` writes already go through PII-redacted `hashEmail` (T22.1). | **OPEN**, ops follow-up. |
| O4 | KV refresh tokens → `HMAC(token, KEK)` with TTL ≤7d. | Current refresh flow uses single 24h JWTs only; no refresh-token rotation primitive yet. Ship when rotation lands. | **OPEN**. |
| O5 | GDPR export ZIPs → R2 with 24h expiry + per-export key emailed out-of-band. | Existing GDPR export already streams through Worker. Re-architect to "stage in R2 + signed download" once `routes/files.ts` is battle-tested. | **OPEN**. |

---

## 3. Encryption design — `columnCipher.ts`

```
ciphertext = "v1." + base64url( nonce || AES-256-GCM(plaintext, key, nonce, AAD) )
key        = HKDF-SHA256(ikm = KEK_PII, salt = "axal-studioos-pii-v1",
                          info = "axal-column-cipher-aead-v1", length = 32 bytes)
AAD        = utf8(`${table}:${column}:${rowId}`)
nonce      = 12 random bytes
tag        = 16 bytes (GCM)
```

**Why AAD-bind to (table, column, rowId).** Without AAD an attacker with
raw-SQL write access could move ciphertext between rows
(e.g. swap user A's encrypted SSN onto user B's row) and the GCM tag
would still verify. Binding AAD makes such tampering produce a decrypt
failure. Caller MUST pass the same AAD on read; if the row id changes
(e.g. row deleted + re-inserted with a new PK), the column must be
re-encrypted.

**HMAC index** uses HKDF-derived subkey + `info = "axal-column-cipher-index-v1"`,
domain-separated by `${table}:${column}`. Normalised (trim + lower-case)
before signing so case-insensitive equality search works.

**Wellbeing data continues to use `services/cryptoBox.ts`** — different
namespace (PBKDF2 / single-secret), incompatible by design.

### 3.1 Signed-download single-use caveat

`signedDownload.ts` enforces single-use by pre-registering the `jti` in
Workers KV at mint time and deleting it on consume. KV has no
compare-and-swap, so the `get`→`delete` window is non-zero. Two
concurrent downloads of the same token within that window can both
succeed.

The mitigation accepted here:
- TTL hard-clamped to 5 minutes (replay window is bounded).
- Every download writes `activity_logs` (`action='signed_download'`),
  so duplicate consumption is detectable post-hoc.

If strictly-once semantics are ever required (e.g. one-time decryption
keys, single-claim invitation links), back the consume with a Durable
Object instead.

---

## 4. JWT alg pinning

`cloudflare-worker/src/auth.ts`:
- `JWT_ALGORITHM = 'HS256'` (only).
- `createJWT` calls `setProtectedHeader({ alg: JWT_ALGORITHM })`.
- `decodeJWT` calls `jwtVerify(token, key, { algorithms: [JWT_ALGORITHM] })`,
  which causes `jose` to reject `none` and any `RS*` / `ES*` / `PS*`
  alg unconditionally.

This is the standard alg-confusion mitigation. Re-confirmed by audit
during Task #33.

---

## 5. Stripe webhook

`routes/billing.ts:verifyStripeSignature` extracts `t=`/`v1=` segments,
HMAC-SHA256s `${t}.${body}` with `STRIPE_WEBHOOK_SECRET`, and uses a
constant-time comparator (`diff |= a^b`) over the hex digest. Length
check happens before the loop so we never short-circuit on prefix
mismatch.

When `STRIPE_WEBHOOK_SECRET` is unset, the route accepts the body as-is
(intentional dev convenience). Production MUST set the secret — see §6.

---

## 6. Required Wrangler secrets (production)

Provision per environment via `npx wrangler secret put <NAME> --env=production`.
Generate raw bytes via `openssl rand -hex 32`. Items marked **HARD-FAIL**
abort the worker boot when missing.

| Secret | Used by | Boot behaviour | Notes |
|---|---|---|---|
| `JWT_SECRET` | `auth.ts` | **HARD-FAIL** in prod if missing or <32 B | Master auth signing key. |
| `SCORING_HMAC_SECRET` | `services/scoreIntegrity.ts` | **HARD-FAIL** in prod if missing or <32 B | Score-integrity HMAC. |
| `KEK_PII` | `services/columnCipher.ts` | Throws on first encrypt in prod if missing | Column-level cipher master key. Dev falls back to `JWT_SECRET`. |
| `KEK_R2` | `services/signedDownload.ts` | Falls back to `JWT_SECRET` (logged) | One-time R2 download token signing. Provision separately so a JWT key rotation doesn't break in-flight download URLs. |
| `AXAL_ENCRYPTION_SECRET` | `services/cryptoBox.ts` | Falls back to `JWT_SECRET` | Wellbeing data cipher. |
| `STRIPE_SECRET_KEY` | `routes/billing.ts`, `routes/funds.ts` | Optional (dev fallback) | Stripe REST API. |
| `STRIPE_WEBHOOK_SECRET` | `routes/billing.ts` | Optional in dev — **MUST be set in prod** | Webhook signature verification. |
| `STRIPE_ATLAS_API_KEY` | `routes/funds.ts` | Optional | Stripe Atlas (incorporation). |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | `services/email.ts` | Optional | Outbound email. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALENDAR_REDIRECT_URI` | `services/calendar.ts` | Optional | Calendar OAuth. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_CALENDAR_REDIRECT_URI` / `MICROSOFT_TENANT_ID` | `services/calendar.ts` | Optional | Outlook OAuth. |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_REDIRECT_URI` | `routes/linkedin.ts` | Optional | LinkedIn OAuth. |
| `TURNSTILE_SECRET_KEY` | `services/turnstile.ts` | Optional | Bot verification on `/register`. |
| `OPENAI_API_KEY` | `services/scoring.ts`, others | Optional | LLM calls. |
| `PERSONA_API_KEY` / `SUMSUB_API_KEY` | `routes/kyc.ts` | Optional | KYC providers. |
| `CF_ACCESS_TEAM_DOMAIN` | `middleware/cfAccess.ts` | Optional — middleware no-op if unset | e.g. `axal.cloudflareaccess.com`. |
| `CF_ACCESS_AUD` | `middleware/cfAccess.ts` | Optional — middleware no-op if unset | Application AUD from the Access dashboard. |

**Operator pre-deploy checklist for the next prod push:**

1. `openssl rand -hex 32 | npx wrangler secret put KEK_PII --env=production`
2. `openssl rand -hex 32 | npx wrangler secret put KEK_R2 --env=production`
3. Confirm `STRIPE_WEBHOOK_SECRET` is set (audit alert if missing).
4. Provision Cloudflare Access app for `axal.vc/api/admin/*`,
   `/api/monitoring/*`, `/api/infra/*`. Set the AUD tag, then
   `wrangler secret put CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
5. Apply migration `cloudflare-worker/sql/migrations/006_security_hardening.sql`
   to the remote D1 (`auth_totp` table + `users.password_reset_required`).

---

## 7. Threat-model invariants

These are the assumptions downstream tasks (#34–#38) MAY rely on:

- **PII at rest**: any column passing through `encryptColumn` returns
  ciphertext under raw SQL. Decryption requires the worker process and
  `KEK_PII`. Last-4 helpers exist for UX (`columnCipher.last4`).
- **R2 downloads**: every download from a non-trusted client MUST go
  through `mintDownloadToken` → `/api/files/dl/:token`. Direct R2 keys
  are not exposed; the bucket is private.
- **TOTP secrets**: live in `auth_totp.secret_ct`, never `users.password_hash`.
  Lazy migration drains legacy users on first login.
- **Admin perimeter**: when CF Access is provisioned, every admin /
  monitoring / infra route requires a valid Access JWT in addition to
  the in-app role check.
- **Activity logs**: actor field is `hashEmail()` everywhere, never the
  raw email (T22.1 invariant — re-affirmed).

---

## 8. Out of scope (this task)

- SMS 2FA (Task #38 — consumes the `auth_totp` table created here).
- Contracts admin view (Task #34).
- Due Diligence module, Investor Signals, Personal Assistant
  (Tasks #35–#37).
- Backfill of existing plaintext PII rows to ciphertext (deferred — see
  §2 O1).
