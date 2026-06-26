# Security Audit Remediation — 2026-06-25

Remediation of the 2026-06-25 security audit of the Cloudflare Worker + SPA
(Task #1). Severity tags follow the audit: **M** = medium, **L** = low.

Each item below records the finding, the fix, and anything still owned by ops.

---

## M1 — Rate limiter failed open on KV outage

**Finding.** When the rate-limit KV store was unreachable, every bucket silently
failed *open* (request allowed), so an outage disabled rate limiting on
sensitive endpoints without any signal.

**Fix.** `cloudflare-worker/src/middleware/rateLimit.ts` gained a per-bucket
`failClosed` flag. Sensitive buckets (`ai`, `promo_validate`,
`admin_catalog_writes`, `register`) are marked fail-closed: on a KV error they
now return **503** `{ code: 'rate_limit_unavailable', retry_after: 30 }` with
`Retry-After` / `X-RateLimit-Bucket` headers and an observable `logBlock`. All
other buckets still fail open, but now do so explicitly with a log line instead
of a silent swallow.

The auth/OTP flows use their **own** KV limiter helpers (separate from the
middleware above): `checkRateLimit` in `routes/auth.ts` (login, registration
resend, email-verify, magic-link, step-up) and the `rate` helpers in
`routes/auth_sms.ts` (SMS OTP enroll/challenge/verify) and
`routes/auth_recover.ts` (account recovery). All three previously failed
**open** on a KV error — the highest-value endpoints (credential stuffing /
OTP brute-force / recovery brute-force) silently lost throttling during an
outage. They now fail **closed**: a KV error denies the request (callers map the
`false` return to `429`) and logs `... (failing closed) bucket=<prefix>`. The
log records only the bucket prefix, never the key tail (which carries the email
/ phone — see L5).

---

## M2 — Blanket founder-resource bypass (cross-founder IDOR) — *highest risk*

**Finding.** `canAccessFounderResource` (auth.ts) blanket-allowed
`admin || partner || investor`. Investors therefore passed the IDOR guard on
routes that carry **no masking** (financials, scoring, progress, pipeline,
deals, legal documents, studioops), leaking unmasked founder data across
founders regardless of any NDA.

**Fix (relationship predicate).**
- `canAccessFounderResource` now grants only **admin/partner** (studio-wide
  staff; there is no per-deal assignment model) plus the **owning founder**.
  Investors get **no** access through this predicate.
- An investor's only path to founder data remains the NDA-gated, fail-closed
  `maskFounderForInvestor` view (projects list/detail, dashboard, private-data).
  `projects.get('/:id')` keeps an explicit `user.role !== 'investor'` branch so
  investors still reach that mask (and only ever see the public-key subset
  unless an active pairwise NDA unlocks more).
- `founder_risk.ts` had a second copy of the same leak: its local
  `isPrivileged` allowlist still included `investor`. Removed, matching the
  IDOR contract already applied to `progress.ts` / `financials.ts`.
- `projects.put('/:id')` carried a **third** local `isPrivileged` allowlist
  (`admin || partner || investor`) that let an investor **edit any founder's
  project** — a write-IDOR / privilege escalation (incl. the admin/partner-only
  `stage` / `status` / `playbook_week` fields). `investor` removed: investors now
  hit the existing `403`. `projects.delete` was already admin/partner/owner-only;
  `projects.post`/`/advance-week` are unchanged (create-own / deal-pipeline ops).

All remaining shared-predicate call sites needed **no change** — removing
`investor` from `canAccessFounderResource` closes them automatically.

**Tests.** `cloudflare-worker/test/founderAccess.authz.test.ts` covers
admin/partner (broad), founder (own row only), investor (denied), and
guest/unknown/null-owner cases. Wired into `npm run test:drift`.

---

## M3 — No drift guard against unsafe `sql.unsafe` interpolation

**Finding.** Nothing prevented a new `sql.unsafe(\`... ${x} ...\`)` (or a
non-literal `unsafe()` argument) from introducing SQL injection.

**Fix.** `scripts/check-sql-unsafe.mjs` scans the worker source, allowlists the
known-safe interpolations, and fails on any new/unsafe one. Wired into
`npm run test:drift` (after `check-api-drift`). The L4 LinkedIn change below
removed the last `${col}` interpolation, so no allowlist entry is needed for it.

---

## M4 — Scoring HMAC reused `JWT_SECRET` verbatim (no domain separation)

**Finding.** When `SCORING_HMAC_SECRET` was unset, scoring integrity HMACs were
signed with the **raw** `JWT_SECRET`, sharing key material across two unrelated
security domains.

**Fix.** `cloudflare-worker/src/services/scoreIntegrity.ts` now derives the key
via `deriveScoringKey(env)`:
- explicit `SCORING_HMAC_SECRET` (≥16 bytes) is used verbatim, else
- an **HKDF-SHA256** subkey over `JWT_SECRET` (salt `axal:score-integrity`,
  info `scoring-hmac:v1`, 256-bit) — domain-separated, never the raw secret.

`INTEGRITY_VERSION` was intentionally **not** bumped (no stored-hash format
change for verification). Production still hard-requires `SCORING_HMAC_SECRET`.

---

## L2 — Article author preview used `dangerouslySetInnerHTML`

**Fix.** `frontend/src/pages/ArticleAuthorPage.jsx` now renders the live
preview through `<ReactMarkdown>` instead of injecting raw HTML, removing the
XSS surface in the editor preview. The public reader continues to render the
server-sanitized `body_html` (the worker renderer is escape-first).

---

## L4 — LinkedIn schema ALTER ran on the request path, swallowing DDL errors

**Fix.** The LinkedIn identity columns (`linkedin_sub`, `linkedin_email`,
`linkedin_name`, `linkedin_connected_at`) now ship in `sql/schema.sql` for
fresh databases. The lazy request-path `ensureColumns()` ALTER (which swallowed
DDL errors and masked schema drift) is removed from `routes/linkedin.ts`.
Existing D1 databases are migrated **manually** via `sql/linkedin_alter.sql`
(`wrangler d1 execute`).

**Ops.** Confirm the four columns exist in the production D1 `users` table;
apply `sql/linkedin_alter.sql` if not.

---

## L5 — Logging hygiene (tokens / PII)

**Finding/Outcome.** Reviewed OAuth, Stripe, Telegram, and auth error paths for
secret/PII leakage into logs. No offending log statements found; no code change
required. Recorded here so the review is auditable.

---

## Remaining ops follow-ups

- **L4:** apply `sql/linkedin_alter.sql` to production D1 if the columns are
  missing.
- **M4:** production already hard-requires `SCORING_HMAC_SECRET`; no action
  unless rotating.

## Known, accepted investor visibility (product decisions — not changed here)

These two routes also treat investors as privileged, but the visibility looks
**intentional** and changing it would alter product behavior (a design call, not
a contained bug). Flagged for a product/security decision rather than fixed
unilaterally:

- **`deals.get('/')`** returns the deal pipeline (incl. `amount`, `notes`,
  `founder_user_id`) to investors. The code deliberately surfaces this for the
  investor deal-flow view / TrustScore badges, and `deals.put` is a documented
  partner/investor/admin operation (Phase 0.1 split). If partner `notes` /
  `amount` should be masked per-investor, that needs a serializer + product sign-off.
- **`legal.get('/documents')`** lists document **metadata** to investors, but the
  payload is already run through `safeDoc` (strips `content` / founder linkage,
  sets `redacted: true`), and the per-document detail (`/documents/:id`) is gated
  by `canAccessFounderResource` (now investor-denied). Lower severity; revisit if
  even document titles/metadata should be hidden from investors.
