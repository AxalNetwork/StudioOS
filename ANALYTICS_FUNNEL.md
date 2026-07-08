# Signup Funnel Analytics (Task #2)

First-party, consent-aware funnel instrumentation. No third-party analytics —
events go from the SPA straight to our own Worker and land in D1. This file is
the single reference for the event dictionary, the privacy contract, the
retention policy, and the queries.

## Architecture

```
frontend/src/lib/funnel.js          consent-gated tracker (batches ≤10 / 5s / pagehide)
        │  POST /api/track  (keepalive fetch, credentials:'omit', prod only)
        ▼
cloudflare-worker/src/routes/track.ts   validate + clip + allowlist, always 204
        ▼
D1 table funnel_events              append-only, purged at 180 days by cron
```

- **Client** (`frontend/src/lib/funnel.js`): events are buffered in memory
  until the visitor grants the **analytics** cookie-consent category (max 20
  buffered; dropped on decline or pagehide). `anon_id` (random UUID,
  localStorage) is minted only **after** consent. First-touch attribution
  (utm_*, `ref`, `lane`, invite markers) is captured once per tab in
  sessionStorage from an **allowlist** of query params — magic-link /
  verification tokens can never ride along. In dev the tracker only
  `console.debug`s; nothing is sent.
- **Server** (`routes/track.ts`): 16 KB body cap, ≤20 events per batch,
  event-name allowlist (below), every field re-validated + clipped,
  query/fragment stripped from `path`/`referrer` as defense in depth. Rate
  bucket `track` = 60/min/IP. Always answers 204 — the sink must never block
  a user flow.
- **Never** use `navigator.sendBeacon` here — it sends cookies, which would
  reopen the CSRF surface this design deliberately avoids.

## Privacy contract

| Stored | Not stored |
|---|---|
| event name, coarse `device` (mobile/desktop), coarse `browser` family | IP address (only in Cloudflare edge logs for abuse forensics) |
| pseudonymous `anon_id` / `session_id` (client UUIDs, post-consent only) | email, user_id, name — any direct identifier |
| `path` / `referrer` with query+fragment stripped | full user-agent |
| allowlisted attribution: `utm_source/medium/campaign`, `ref_code`, `lane`, `invite_type` | arbitrary query params, tokens |
| `props` JSON ≤500 bytes (event-specific, see dictionary) | anything after 180 days (cron purge) |

Consent: the tracker only ships events after the visitor granted the
**analytics** category in the cookie banner. Declining drops the buffer and
never mints an `anon_id`.

## Schema (`funnel_events`, migration 146)

Append-only. `created_at` (UTC, server clock) is authoritative for windows;
`client_ts` (ms epoch, client clock) only orders events *within* a session.
Indexes: `(event, created_at)` and `(anon_id, created_at)`.
The worker also lazily bootstraps the table via
`services/funnelEventsSchema.ts` so `/api/track` self-heals on a DB the
migration has not reached.

## Event dictionary (21 events — keep the 3 lists in sync)

The allowlist lives in **`cloudflare-worker/src/routes/track.ts`**
(`FUNNEL_EVENT_ALLOWLIST`), **`frontend/src/lib/funnel.js`** (`EVENTS`) and
this table. A name missing from any of the three is silently dropped.

| Event | Fired | Props |
|---|---|---|
| `landing_view` | `/` mount | — |
| `register_view` | `/register` mount | — |
| `register_form_start` | first keystroke in name/email (once per mount) | — |
| `register_field_error` | client-side validation failure | `field`: name\|email |
| `register_turnstile_failed` | Turnstile script never loaded (~10 s poll gave up) | — |
| `register_submit` | signup attempt sent | `mode`: magic\|classic\|google |
| `register_success` | signup accepted | `mode`; classic adds `email_sent` (bool — **see alert below**) |
| `register_resend_click` | "resend email" clicked | `mode` |
| `verify_email_view` | verification link opened | — |
| `verify_email_result` | verification settled | `outcome`: success\|error; success adds `signed_in` (bool); error may add `reason: missing_token` |
| `totp_setup_start` | enrolment wizard mounted | — |
| `totp_setup_complete` | authenticator confirmed (persists server-side) | — |
| `totp_setup_abandon` | gave up mid-enrolment | `reason`: cancel\|pagehide |
| `login_view` | `/login` mount | — |
| `login_submit` | sign-in attempt | `method`: totp\|magic\|passkey\|google (magic = link requested) |
| `login_error` | sign-in failed | `method`; optional `reason` (`totp_missing`, `cancelled`, `send_failed`, bounced `?google_error=`/`?magic_error=` code) |
| `login_success` | session stored, redirecting | `method`: totp\|passkey (magic/google complete server-side) |
| `onboarding_chat_view` | post-auth profiling chat mount | — |
| `onboarding_chat_complete` | saved with ≥1 answer | `user_turns` |
| `onboarding_chat_skip` | "skip for now" | `user_turns` |
| `dashboard_first_view` | first dashboard render **ever per browser** (localStorage-deduped `trackOnce`) | — |

## Funnel edges

```
landing_view
  → register_view → register_form_start → register_submit → register_success
      → verify_email_view → verify_email_result(outcome=success)
          → [optional] totp_setup_start → totp_setup_complete | totp_setup_abandon
          → onboarding_chat_view → onboarding_chat_complete | onboarding_chat_skip
              → dashboard_first_view          ← activation
login_view → login_submit → login_success | login_error   (returning users)
```

Notes for interpretation:
- `register_submit(mode=google)` and `login_submit(method=google)` have **no
  success counterpart** — the OAuth callback lands the user signed in;
  failures bounce back and are tracked as `login_error(method=google)`.
- `login_submit(method=magic)` = link requested; a successful magic sign-in
  never re-enters the SPA login page, so there is no client-side
  `login_success(method=magic)`. Use the baseline query (below) for
  authoritative sign-in counts.

### Example: 7-day step conversion (unique anon_ids)

```sql
SELECT event, COUNT(DISTINCT anon_id) AS uniques, COUNT(*) AS total
FROM funnel_events
WHERE created_at >= datetime('now', '-7 days')
  AND event IN ('landing_view','register_view','register_form_start',
                'register_submit','register_success','verify_email_view',
                'verify_email_result','onboarding_chat_view','dashboard_first_view')
GROUP BY event
ORDER BY CASE event
  WHEN 'landing_view' THEN 1 WHEN 'register_view' THEN 2
  WHEN 'register_form_start' THEN 3 WHEN 'register_submit' THEN 4
  WHEN 'register_success' THEN 5 WHEN 'verify_email_view' THEN 6
  WHEN 'verify_email_result' THEN 7 WHEN 'onboarding_chat_view' THEN 8
  WHEN 'dashboard_first_view' THEN 9 END;
```

## ⚠️ `email_sent:false` alert

`register_success` with `props.email_sent = false` means the account was
created but the verification email **silently failed to send** (provider
outage / misconfiguration) — the exact drop-off the audit flagged. Check
weekly, or whenever verify-rate dips:

```sql
SELECT date(created_at) AS day,
       SUM(json_extract(props,'$.email_sent') = 0) AS email_failed,
       COUNT(*) AS classic_signups
FROM funnel_events
WHERE event = 'register_success'
  AND json_extract(props,'$.mode') = 'classic'
  AND created_at >= datetime('now', '-14 days')
GROUP BY day ORDER BY day DESC;
```

**Threshold: any day with `email_failed > 0` warrants a look at the email
provider; `email_failed / classic_signups > 10%` is an incident** (verify
funnel is bleeding). There is no automated alert yet — this query is the
manual check.

## Retention — 180 days

The nightly cron in `cloudflare-worker/src/index.ts` (04:20 UTC) runs:

```sql
DELETE FROM funnel_events WHERE created_at < datetime('now', '-180 days');
```

Manual equivalent (if the cron were ever suspect):

```bash
npx wrangler d1 execute studioos --remote \
  --command "DELETE FROM funnel_events WHERE created_at < datetime('now','-180 days')"
```

## Baseline: server-side signup funnel from `activity_logs`

`funnel_events` starts empty (and only counts consented visitors). The
authoritative server-side baseline — registrations, verifications, sign-ins —
lives in `activity_logs` and predates this instrumentation. Compare the two to
estimate consent-rate and to sanity-check funnel numbers:

```bash
npx wrangler d1 execute studioos --remote --command "
SELECT date(created_at) AS day,
  SUM(action = 'user_registered')   AS registered,
  SUM(action = 'email_verified')    AS verified,
  SUM(action IN ('user_login','user_login_magic','user_login_google',
                 'user_login_google_signup','user_login_passkey',
                 'user_login_sms','user_login_recovery_code')) AS signins
FROM activity_logs
WHERE created_at >= datetime('now', '-30 days')
GROUP BY day ORDER BY day DESC;"
```

(`user_login` = TOTP; the `user_login_*` variants cover the other methods.
Run with the same Node 22 PATH export used for deploys — see `replit.md`.)

## Out of scope (deliberate)

- No third-party analytics (GA, PostHog, …) — first-party only.
- No dashboards — SQL over `funnel_events` via `wrangler d1 execute`.
- No user-level identity stitching: `anon_id` is never joined to `users`.
