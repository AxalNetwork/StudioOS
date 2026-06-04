# Beta Readiness Audit — 2026-06-03 (re-audit)

**Task:** Scheduled 14-day re-audit (GitHub issue [#68](https://github.com/AxalNetwork/StudioOS/issues/68), fired by `.github/workflows/beta-readiness-reaudit.yml`). Re-grade every row of `BETA_READINESS_AUDIT_2026-05-20.md` against current code + the live system, refresh the punch list, and identify shipped issues eligible to close.
**Method:** Live `curl` against the production Cloudflare Worker (`https://axal.vc`) and the dev FastAPI (`http://localhost:8000`), plus code inspection of `cloudflare-worker/src/` and `backend/app/`. **No production writes** (read-only curl / code inspection / read-only checks only).
**Auditor:** Replit Agent (Task #2).
**Previous audit:** `BETA_READINESS_AUDIT_2026-05-20.md`.
**Next re-audit:** 2026-06-17 (every 14 days via the same workflow).

## Legend
- 🟢 **green** — shipped and verified end-to-end (or by code inspection where a live token is required)
- 🟡 **partial** — code path exists but a check failed, evidence is indirect, or coverage is incomplete
- 🔴 **red** — not shipped or broken
- **Δ** column flags movement since 2026-05-20: ⬆️ improved · ⬇️ regressed · = unchanged
- Issue refs preserve the original `BLOCK-*` / `NICE-*` ids from `BETA_READINESS_ISSUES_2026-05-20.md` for traceability. Those issues were **never filed on GitHub** (the search `BLOCK-AUTH-01 in:title` returns 0 results) — they remain paste-ready bodies in the staging file. See "Filing & closing" at the bottom.

## Notes on the production topology (unchanged)
- `https://axal.vc/` (root) is still served by **GitHub Pages** (Jekyll marketing site); `curl https://axal.vc/` → **200**.
- `https://axal.vc/api/*` is the Cloudflare Worker; `/api/health` → **200**, all bindings green.
- Marketing routes (`/spinout-lab`, `/about`, `/insights`, `/directory`) still **404** from GitHub Pages — the React SPA has these pages but is not the public-facing host.

---

## AUTH

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Magic-link signup live | 🔴 red | = | `POST https://axal.vc/api/auth/magic/start` → **404**. No `magic/start`/`magic/verify` route in `cloudflare-worker/src/routes/auth.ts` (only aspirational comments in `index.ts:29,352`). Defined auth routes: register, resend-verification, verify-email, confirm-verify-email, setup-totp, login, logout, me, verify-totp. | Ship magic-link route on the Worker (passwordless email start + verify). | BLOCK-AUTH-01 |
| Passkey registration live | 🔴 red | = | `GET /api/auth/passkey/register-options` → **404**. No WebAuthn/passkey routes; only a comment mention at `auth.ts:839`. | Add WebAuthn registration + assertion routes. | BLOCK-AUTH-02 |
| TOTP off `password_hash` | 🟢 green | = | Code unchanged: TOTP secrets in encrypted `auth_totp`; `users.password_hash` untouched. | Done. | — |
| Step-up middleware enforced | 🟡 partial | ⬆️ | New `middleware/recoveryCoolOff.ts` + step-up-due logic in `auth.ts:325-328` (`recovery_step_up_due_at`) and a step-up nag cleared in `settings.ts:562`. This covers the **recovery** flow, but there is still no general `requireStepUp` wrapping admin/payments routes. | Add a general `requireStepUp` (≤ N min since last TOTP) on admin + payments routes; the recovery step-up plumbing is a good base. | BLOCK-AUTH-03 |
| `/sign-out-everywhere` exists + bumps `jwt_min_iat` | 🟡 partial | = | Endpoint is `POST /api/settings/sessions/revoke-all` (`settings.ts:645`, `UPDATE users SET jwt_min_iat`). Naming still differs from the spec path. | Rename to match spec or update the spec/docs. | NICE-AUTH-04 |

---

## 500s FROM ERROR DASHBOARD

Dev-FastAPI checks are unauthenticated curls; **401 = mounted & reachable** (the real "no 500" smoke test), **404 = missing**, **500 = crash**, **307 = trailing-slash redirect**.

| Row | Status | Δ | Observed (dev `:8000`) | Next action | Issue |
|---|---|---|---|---|---|
| `/api/integrations` → 200 empty | 🟡 partial | = | **401** (no 500) | Re-test with auth. | NICE-500-01 |
| `/api/calendar/events` → 200 empty | 🟡 partial | = | **401** | Re-test with auth. | NICE-500-01 |
| `/api/financials/:projectId` → 200 default | 🟡 partial | = | **401** | Re-test with auth. | NICE-500-02 |
| `/api/progress/metrics/:projectId` → 200 default | 🟡 partial | = | **401** | Re-test with auth. | NICE-500-02 |
| `/api/wellbeing/checkins` POST → 201 | 🟡 partial | = | Write path; route present in `backend/app/api/routes/wellbeing.py`, not exercised. | Add integration test. | NICE-500-03 |
| `/api/deals` → 200 on empty | 🟡 partial | = | **307** (→ `/api/deals/`), not a 500. | Resolve trailing-slash with auth. | NICE-500-01 |
| `/api/projects` → 200 on empty | 🟡 partial | = | **307** | Same. | NICE-500-01 |
| `/api/projects/:id` → 404 for missing | 🟡 partial | = | **401** (auth gate before lookup) | Re-test with auth. | NICE-500-04 |
| `/api/partnernet/summary` → 200 default | 🟡 partial | = | **401** | Re-test with auth. | NICE-500-01 |
| `/api/capital/portfolio` → 200 default | 🟡 partial | = | **401** | Re-test with auth. | NICE-500-01 |
| `/api/monitoring/analytics/overview` → 200 (admin) | 🟡 partial | = | **401** | Re-test with admin token. | NICE-500-01 |
| `/api/pipeline/active` → 200 on empty | 🟡 partial | ⬆️ | Worker now has `pipeline.get('/active')` (`routes/pipeline.ts:132`) — **prod path shipped**. Dev FastAPI still **404** (only `pipeline_votes` mounted, `main.py:440`). Dev-mirror gap, not a prod blocker. | Mount the dev FastAPI `/api/pipeline/active` shim to match the Worker. | BLOCK-500-05 |
| `/api/infra/queue` → 200 default | 🟡 partial | = | **401** (no 500) | Re-test with admin token. | NICE-500-01 |
| `/api/legalcap/capital/lp-portal` → 200 default | 🟡 partial | ⬆️ | Worker `routes/legalcap.ts` exists (prod path present); dev FastAPI still **404** (no `legalcap` prefix; dev has `liquidity.py`/`funds.py`/`capital.py`). Dev-mirror gap. | Mount the dev FastAPI shim or align the dashboard URL with the Worker path. | BLOCK-500-06 |
| `/api/pipeline/ws/overview` — WS upgrade | 🟡 partial | = | `durable_pipeline` true on `/api/health`; handshake not exercised. | Spot-check WS. | NICE-500-08 |
| `/api/onboarding/ws/*` — WS upgrade | 🟡 partial | = | `durable_onboarding` true on `/api/health`; handshake not exercised. | Spot-check WS. | NICE-500-08 |
| `/api/advisor/explain` → 200 w/ retry/KV | 🟡 partial | = | `POST https://axal.vc/api/advisor/explain` unauth → **401** (route present, auth gate fires). | Re-test with a real token + cold/warm cache pair. | NICE-500-07 |

---

## ADVISOR

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Admin persona bank exists | 🟡 partial | = | `ADMIN_BANK` in `services/advisor/questionBank.ts:168` still contains **1 question**. | Expand `ADMIN_BANK` to ≥10. | NICE-ADV-01 |
| Repeat-question test passes | 🔴 red | = | `cloudflare-worker/test/` has `advisor.scenarios.test.ts` + `advisor.stateMachine.test.ts` — **no repeat-question test**. | Add a repeat-question regression test. | BLOCK-ADV-02 |
| Workers AI per turn — model + latency | 🟡 partial | = | `aiClient.ts::runAdvisorTurn()` returns model + provider via SSE. | Re-test with auth + capture SSE. | NICE-ADV-03 |
| AI Gateway slug `advisor-ongoing` | 🟡 partial | = | `aiRouter.ts` injects gateway id for advisor tasks; dashboard slug still operator-created. | Operator: create the `advisor-ongoing` gateway in CF dashboard. | BLOCK-ADV-04 |
| Free-form question handled | 🟡 partial | = | `/api/advisor/explain` present; auth-gated. | Re-test with auth. | NICE-ADV-05 |
| Tool-call rate-limit enforced | 🟡 partial | = | KV daily turn cap exists; per-second burst guard not separately verified. | Add burst guard or document daily cap as sole limiter. | NICE-ADV-06 |
| Dynamic question generator (`dyn.*`) | 🔴 red | = | `rg "dyn\.|generateDynamic|dynamic.*question"` in `services/advisor/` → **0 hits**. | Implement a dynamic-question generator for bank-exhausted users. | BLOCK-ADV-07 |

---

## CONTRACTS / TRUST

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Admin > Contracts union | 🟢 green | = | `routes/admin_contracts.ts` mounted; `test/admin_contracts_union.test.mjs` present. | — | — |
| Pairwise NDAs visible | 🟡 partial | = | `services/trustEnvelope.ts`/`trust.ts`/`routes/trust.ts` reference `pairwise_ndas`; prod D1 schema not confirmed in this read-only pass (no remote D1 query run). | Run read-only `SELECT name FROM sqlite_master WHERE name='pairwise_ndas'` on prod D1; flip to green if present. | NICE-TRUST-01 |
| Sanctions screening live | 🟢 green | = | `services/sanctions.ts`; regression test `test/sanctions_match.test.mjs`. | — | — |
| Founder ↔ Investor 3-way NDA | 🟢 green | = | `services/trustEnvelope.ts` three-party envelopes; `test/trust_intro.test.mjs`. | — | — |

---

## INTEGRATIONS

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Stripe Connect OAuth round-trip | 🟡 partial | = | `integrations/providers/stripe.ts` present; no live round-trip test. | Manual round-trip + capture redirect. | NICE-INT-01 |
| Stripe MRR → `financial_models.source='stripe'` | 🔴 red | = | No `stripe` reference in `routes/financials.ts` (only schema self-heal). No MRR ingest path. | Wire the Stripe → `financial_models.source='stripe'` pull. | BLOCK-INT-02 |
| Google Calendar OAuth callback | 🟢 green | = | `services/calendar.ts`; refresh tokens encrypted at rest. | — | — |
| Outlook OAuth callback | 🟢 green | = | `MICROSOFT_*_CALENDAR_REDIRECT_URI` documented. | — | — |
| LinkedIn OAuth redirect URI = `axal.vc` | 🟡 partial | = | `routes/linkedin.ts` exists; redirect URI not inspected this pass. | Grep `routes/linkedin.ts` for the redirect; fix if `workers.dev`. | NICE-INT-03 |
| HubSpot/Carta/Affinity/DocuSign tiles | 🟡 partial | = | hubspot + docusign present; Carta/Affinity not confirmed. | Audit `IntegrationsPage.jsx` provider list. | NICE-INT-04 |

---

## MARKETING / PUBLIC

All four routes still 404 on prod because `https://axal.vc/` is the GitHub Pages Jekyll site, not the React SPA.

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Front-page content refresh | 🟡 partial | = | `curl https://axal.vc/` → **200**, still Jekyll. | Decide Jekyll vs SPA as the public surface; refresh the winner. | BLOCK-MKT-01 |
| `/spinout-lab` expansion | 🔴 red | = | `curl https://axal.vc/spinout-lab` → **404**. | Publish on Jekyll (or proxy to SPA). | BLOCK-MKT-02 |
| `/about` — Guillaume's card | 🔴 red | = | **404**. | Ship `/about` on the public origin. | BLOCK-MKT-03 |
| `/insights` — seed articles | 🔴 red | = | **404**. | Publish `/insights`. | BLOCK-MKT-04 |
| `/directory` — public list | 🔴 red | = | **404**. | Publish `/directory`. | BLOCK-MKT-05 |
| Hero — drop "Three lanes —" prefix | 🔴 red | = | Jekyll hero copy unchanged. | Update Jekyll hero copy. | BLOCK-MKT-06 |
| Contact form → GitHub Issue round-trip | 🟢 green | ⬆️ | `routes/tickets.ts` now ships the full round-trip: `tickets.post('/')` creates an issue via `POST https://api.github.com/repos/{owner}/{repo}/issues` (`tickets.ts:109-121`), plus `fetchGithubIssue()`/comments read-back and `github_issue_number`/`github_issue_url` columns. Live round-trip not exercised (needs `GITHUB_REPO_OWNER/NAME` + token in prod). | Confirm one live submission lands an issue in prod. | NICE-MKT-07 |

---

## ADMIN UX

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| FOUNDER_ID + PARTNER_ID generated | 🟢 green | = | `services/publicIds.ts`, `routes/esign.ts`, `routes/admin.ts` reference public ids. | Verify backfill on prod D1 (read-only count). | NICE-ADM-01 |
| `users.last_active_at` populated | 🟢 green | = | `middleware/lastActive.ts` mounted. | — | — |
| Admin onboarding transcripts visible | 🟡 partial | = | `routes/admin.ts` large; transcript surface not UI-verified. | UI walkthrough as admin. | NICE-ADM-02 |
| Admin ongoing advisor transcripts | 🟡 partial | = | `routes/admin_advisor_audit.ts` exists; UI tab not inspected. | UI walkthrough as admin. | NICE-ADM-02 |

---

## PAYMENTS

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Stripe checkout end-to-end (test) | 🟡 partial | = | `routes/billing.ts` handles checkout + webhooks; live round-trip not run. | Run test-mode checkout end-to-end. | NICE-PAY-01 |
| Tier flips on `subscription.created` | 🟢 green | = | `routes/billing.ts` handles created/updated. | — | — |
| Tier flips on `subscription.deleted` | 🟢 green | = | `routes/billing.ts` handles deleted. | — | — |
| Refund flow (admin → Stripe refund) | 🔴 red | = | `rg "refund"` in `routes/billing.ts` + `routes/admin*.ts` → **0 hits**. No admin refund endpoint. | Implement `POST /api/admin/billing/refund` → `stripe.refunds.create`. | BLOCK-PAY-02 |
| Free-tier paywall — 402 + upgrade UI | 🟢 green | = | `PaywallModal.jsx` + `openPaywall(lockTier)` wired. | — | — |

---

## SETTINGS

`frontend/src/pages/SettingsPage.jsx` hosts all tabs; no UI walkthrough performed (each row partial pending UI verification), unchanged from 2026-05-20.

| Row | Status | Δ | Observed | Next action | Issue |
|---|---|---|---|---|---|
| Profile > Identity | 🟡 partial | = | `PersonalIdentityCard`. | Manual round-trip. | NICE-SET-01 |
| Profile details | 🟡 partial | = | Same file. | UI walkthrough. | NICE-SET-01 |
| Legal entity | 🟡 partial | = | `CorporateIdentityCard`. | UI walkthrough. | NICE-SET-01 |
| Digest & quiet hours | 🟡 partial | = | Saves to `/api/settings/notifications`. | UI walkthrough. | NICE-SET-01 |
| Visibility | 🟡 partial | = | Code present. | UI walkthrough. | NICE-SET-01 |
| Integrations panel | 🟡 partial | = | Route mounted (401, no 500). | UI walkthrough. | NICE-SET-01 |
| Developer | 🟡 partial | = | `roles:['admin']` filter. | UI walkthrough as admin. | NICE-SET-01 |
| Appearance — theme persists | 🟢 green | = | `SettingsContext` flips `data-theme` + `.dark`. | — | — |

---

## SECURITY HEADERS

Source: `curl -I https://axal.vc/api/health` (2026-06-03).

| Row | Status | Δ | Observed | Next action | Issue |
|---|---|---|---|---|---|
| CSP | 🟢 green | = | `content-security-policy: default-src 'self'; …` (nonce + strict-dynamic; verified present). | Run `securityheaders.com` post-deploy to confirm A+. | — |
| HSTS | 🟢 green | = | `strict-transport-security: max-age=63072000; includeSubDomains; preload` | — | — |
| X-Frame-Options | 🟢 green | = | `x-frame-options: DENY` | — | — |
| Referrer-Policy | 🟡 partial | = | `referrer-policy: no-referrer` — stricter than the spec's `strict-origin-when-cross-origin`. | Reconcile the checklist or relax. | NICE-SEC-01 |

Extras still observed (positive): `cross-origin-opener-policy: same-origin`, `cross-origin-resource-policy: same-site`, full `permissions-policy` lockdown, `x-content-type-options: nosniff`.

---

## OPS

| Row | Status | Δ | Observed (2026-06-03) | Next action | Issue |
|---|---|---|---|---|---|
| Tail Worker forwarding to R2 | 🟢 green | = | `[[tail_consumers]] service = "studioos-tail"` in `wrangler.toml`. | Operator: confirm R2 has recent objects. | — |
| DLQ exists + visible in admin | 🟢 green | ⬆️ | `routes/infra.ts` now ships `GET /api/infra/dlq` (`infra.ts:184`, reads `dead_letter_queue` LIMIT 100) plus a cleanup path (`/api/infra/cleanup`, purges DLQ >30d) and a self-heal that creates the `dead_letter_queue` table. DLQ is now admin-visible. | Confirm a retry action + UI surface; note this reads the DB-backed `dead_letter_queue`, distinct from the CF queue `studioos-job-queue-dlq`. | BLOCK-OPS-02 |
| `/api/health` deep check | 🟢 green | = | Live: `{"status":"ok",…,"bindings":{"db":true,"kv_tokens":true,"kv_rate_limits":true,"durable_pipeline":true,"durable_onboarding":true}}` | — | — |
| Cron triggers firing | 🟡 partial | = | Crons declared in `wrangler.toml`; no admin "last run / next run" surface. | Add a last-run timestamp surface. | NICE-OPS-03 |
| Workers Traces enabled | 🔴 red | = | `wrangler.toml` `[observability.traces] enabled = false` (logs are `true`). | Flip `[observability.traces].enabled = true` and redeploy. | BLOCK-OPS-04 |

---

## ICP walkthroughs — still deferred

Prod magic-link + passkey remain 🔴 red, so real prod sign-up is still blocked. Dev FastAPI still seeds only demo investor + founder (2 of 5 ICPs). **Decision unchanged:** defer the 5-ICP walkthrough until magic-link + passkey land on the Worker. Track as `BLOCK-WALKTHROUGH-01`.

---

## Punch list — red/partial rows grouped by owning PR (2026-06-03)

### IB — Email + Notifications (+ magic-link auth + auth gaps)
- BLOCK-AUTH-01 — Magic-link signup on Worker *(still red)*
- BLOCK-AUTH-02 — Passkey registration on Worker *(still red)*
- BLOCK-AUTH-03 — General `requireStepUp` on admin/payments *(red → partial: recovery step-up infra now present)*
- NICE-AUTH-04 — Rename/document `/sessions/revoke-all` ↔ `/sign-out-everywhere`
- NICE-500-01 / -02 / -07 — Re-test empty-state + advisor `/explain` once auth tokens are issuable

### IC — Empty/Error/Mobile/A11y
- NICE-500-03 — Wellbeing checkins POST integration test
- NICE-500-04 — Verify `/api/projects/:id` 404 contract under auth
- NICE-SET-01 — Walk every Settings tab
- BLOCK-WALKTHROUGH-01 — 5-ICP walkthrough once IB lands auth

### ID — Public Marketing
- BLOCK-MKT-01 — Jekyll vs SPA decision + front-page refresh
- BLOCK-MKT-02 / -03 / -04 / -05 — Publish `/spinout-lab`, `/about`, `/insights`, `/directory`
- BLOCK-MKT-06 — Drop "Three lanes —" prefix

### IE — Backup + DR / Ops
- BLOCK-OPS-04 — Flip `[observability.traces].enabled` to `true`
- NICE-OPS-03 — Surface cron last-run / next-run timestamps
- NICE-500-08 — WS upgrade spot-check

### IF — Onboarding Checklist
- BLOCK-500-05 — `/api/pipeline/active` dev FastAPI shim *(red → partial: Worker route shipped; dev mirror missing)*
- BLOCK-500-06 — `/api/legalcap/capital/lp-portal` dev FastAPI shim *(red → partial: Worker route present; dev mirror missing)*

### IG — Cmd+K + Help + Chat (+ admin UX)
- NICE-ADM-01 — Confirm FOUNDER_ID / PARTNER_ID backfill on prod D1
- NICE-ADM-02 — Admin Onboarding + Ongoing advisor transcripts UI

### IH — Data Import (+ integrations data pulls)
- BLOCK-INT-02 — Stripe MRR → `financial_models.source='stripe'`
- NICE-INT-01 / -03 / -04 — Stripe Connect round-trip; LinkedIn redirect URI; provider tiles

### II — Refer&Earn Payouts (+ payments)
- BLOCK-PAY-02 — Refund flow (admin endpoint + Stripe refund call)
- NICE-PAY-01 — Stripe test-mode checkout end-to-end

### Advisor track (own)
- BLOCK-ADV-02 — Repeat-question regression test
- BLOCK-ADV-04 — Create `advisor-ongoing` AI Gateway slug (operator)
- BLOCK-ADV-07 — Dynamic question generator (`dyn.*`)
- NICE-ADV-01 — Expand `ADMIN_BANK`
- NICE-ADV-03 / -05 / -06 — SSE transcript; free-form `/explain` smoke; per-second burst guard

### Trust / Sec / Misc
- NICE-TRUST-01 — Confirm `pairwise_ndas` on prod D1
- NICE-SEC-01 — Reconcile `Referrer-Policy: no-referrer` vs spec

---

## Close list — shipped since 2026-05-20 (eligible to close)

| Issue | What shipped | Evidence |
|---|---|---|
| **BLOCK-OPS-02** | DLQ is now admin-visible | `routes/infra.ts:184` `GET /api/infra/dlq` (reads `dead_letter_queue`) + `/api/infra/cleanup` + self-heal table create |
| **NICE-MKT-07** | Contact form → GitHub Issue round-trip implemented | `routes/tickets.ts:109-121` `POST /` creates an issue; `fetchGithubIssue()` + comments read-back; `github_issue_number`/`_url` columns |

Partial improvements (NOT yet closeable): **BLOCK-AUTH-03** (recovery step-up infra only), **BLOCK-500-05** & **BLOCK-500-06** (Worker route shipped; dev FastAPI mirror still missing).

---

## Filing & closing

The `BLOCK-*` / `NICE-*` issues were **never filed on GitHub** — searching `BLOCK-AUTH-01 in:title` on `AxalNetwork/StudioOS` returns 0 results, and the bodies live only in `BETA_READINESS_ISSUES_2026-05-20.md`. There are therefore no real issue numbers to close yet. The only real issue is the tracking issue **#68** (`Beta Readiness re-audit — 2026-06-03`, OPEN).

`gh` in this environment is authenticated read-only as `guillaumelauzier` (the available PAT 403s on Issue **writes**), so the commands below are **paste-ready for the user** to run in a shell with write access — this audit performed no writes.

```bash
gh repo set-default AxalNetwork/StudioOS

# 1) (Optional) File the two shipped issues just so they can be closed with a paper trail,
#    or skip filing and simply note them as resolved in this audit.
#    Bodies are in BETA_READINESS_ISSUES_2026-05-20.md.
# gh issue create --title "BLOCK-OPS-02 — DLQ admin surface" --label "beta-blocker" --body "Shipped: GET /api/infra/dlq. Closed by 2026-06-03 re-audit."
# gh issue create --title "NICE-MKT-07 — Contact form → GitHub Issue" --label "beta-nice" --body "Shipped: tickets.post('/') creates a GitHub issue. Closed by 2026-06-03 re-audit."

# 2) If/when those issues exist, close them:
# gh issue close <NN> --comment "Shipped — verified in BETA_READINESS_AUDIT_2026-06-03.md."

# 3) Attach this re-audit doc to the tracking issue #68 and close it:
gh issue comment 68 --body "Re-audit complete. New ground truth: BETA_READINESS_AUDIT_2026-06-03.md. Shipped since 2026-05-20: BLOCK-OPS-02 (DLQ surface), NICE-MKT-07 (contact form → GitHub issue). Improved to partial: BLOCK-AUTH-03, BLOCK-500-05, BLOCK-500-06."
gh issue close 68 --comment "Superseded by BETA_READINESS_AUDIT_2026-06-03.md; next re-audit 2026-06-17."
```

---

## Re-audit schedule

`.github/workflows/beta-readiness-reaudit.yml` fires again on **2026-06-17** (every 14 days) and opens a fresh tracking issue referencing the latest `BETA_READINESS_AUDIT_*.md` (this file) for the next hand-off.
