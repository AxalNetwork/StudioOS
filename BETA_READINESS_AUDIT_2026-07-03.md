# Beta Readiness Audit — 2026-07-03 (re-audit)

**Task:** Scheduled 14-day re-audit (GitHub issue [#124](https://github.com/AxalNetwork/StudioOS/issues/124), fired by `.github/workflows/beta-readiness-reaudit.yml`). Re-grade every row of `BETA_READINESS_AUDIT_2026-06-03.md` against current code, refresh the punch list, and identify shipped issues eligible to close.
**Method:** Code inspection of `cloudflare-worker/src/`, `backend/app/`, `wrangler.toml`, and the `test:drift` gate. **No production writes.** Live `curl` is deferred wherever a route binds only on `npm run deploy` or requires an auth token — those rows are graded by code inspection and flagged inline (consistent with the legend below).
**Auditor:** Replit Agent (Task #51).
**Previous audit:** `BETA_READINESS_AUDIT_2026-06-03.md`.
**Next re-audit:** 2026-07-17 (every 14 days via the same workflow).

## Legend
- 🟢 **green** — shipped and verified end-to-end (or by code inspection where a live token / deploy is required)
- 🟡 **partial** — code path exists but a check is pending, evidence is indirect, or coverage is incomplete
- 🔴 **red** — not shipped or broken
- **Δ** flags movement since 2026-06-03: ⬆️ improved · ⬇️ regressed · = unchanged
- Issue refs preserve the original `BLOCK-*` / `NICE-*` ids from `BETA_READINESS_ISSUES_2026-05-20.md` for traceability.
- **Headline:** the 2026-06-03 blocker list is essentially cleared. Every prod-side `BLOCK-*` from AUTH, ADVISOR, INTEGRATIONS, PAYMENTS, OPS, and MARKETING has shipped. The only remaining in-repo work is a dev-FastAPI mirror shim (BLOCK-500-05) and a naming reconciliation (NICE-AUTH-04) — both carried by sibling **Task #52**. Authenticated re-tests + the 5-persona walkthrough (unblocked now that auth landed) are carried by sibling **Task #53**. The rest are operator-only actions (dashboards, prod-D1 counts, live round-trips), noted but not executed by this audit.

## Notes on the production topology
- `https://axal.vc/` (root) is still served by **GitHub Pages** (Jekyll marketing site).
- `https://axal.vc/api/*` is the Cloudflare Worker.
- **Change since 2026-06-03:** the app-owned marketing routes (`/spinout-lab`, `/about`, `/insights`, `/directory`, `/contact`, `/articles`) are now carved to the Worker/SPA in **both** `wrangler.toml` route blocks (top-level `[[routes]]` and `[[env.production.routes]]`, exact + `/*` each). The React SPA is now the public surface for app-owned routes; Jekyll keeps the apex root and any unrouted path. **These bind on `npm run deploy`** — graded 🟢 by config inspection, not yet re-verified via live `curl` in this read-only pass.

---

## AUTH

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Magic-link signup live | 🟢 green | ⬆️ | `POST /api/auth/magic/start` (`auth.ts:902`) emails a single-use 15-min link (IP + per-email rate-limited, `magic_link_tokens` table); `GET /api/auth/magic/verify` (`auth.ts:947`) claims it, find-or-creates the account, and mints a **lower-assurance** session (`factor='magic'`) so `requireFactor('totp')` still gates sensitive routes. | Done. | BLOCK-AUTH-01 |
| Passkey registration live | 🟢 green | ⬆️ | `routes/auth_passkey.ts` + `util/webauthn.ts` ship WebAuthn registration + assertion. A passkey is a strong, phishing-resistant factor, so it satisfies the step-up gate. | Done. | BLOCK-AUTH-02 |
| TOTP off `password_hash` | 🟢 green | = | Unchanged: TOTP secrets in encrypted `auth_totp`; `users.password_hash` untouched. | Done. | — |
| Step-up middleware enforced | 🟢 green | ⬆️ | General `requireStepUp` (`auth.ts:531`) — recent-TOTP (not merely TOTP-minted-session) — is now applied on `admin.ts`, `admin_billing.ts`, `admin_promos.ts`, `admin_contracts.ts`, `dd.ts`, `kyc.ts`, and `billing.ts`. The 06-03 gap (recovery-only) is closed. | Done. | BLOCK-AUTH-03 |
| `/sign-out-everywhere` exists + bumps `jwt_min_iat` | 🟡 partial | ⬆️ | Two endpoints now bump `users.jwt_min_iat`: `POST /api/settings/sessions/revoke-all` (`settings.ts:646`) **and** a new alias `POST /api/auth/revoke-all` (`auth.ts:1070`). Functionally complete; naming still differs from the spec path `/sign-out-everywhere`. | Reconcile naming (alias or update spec/docs). Doc-only. → **Task #52** | NICE-AUTH-04 |

---

## 500s FROM ERROR DASHBOARD

Dev-FastAPI checks: **401 = mounted & reachable** (the real "no 500" smoke test), **404 = missing**, **307 = trailing-slash redirect**. Most rows below stay 🟡 pending an *authenticated* re-test — now unblocked by magic-link and carried by the 5-persona walkthrough (**Task #53**).

| Row | Status | Δ | Observed | Next action | Issue |
|---|---|---|---|---|---|
| `/api/integrations` → 200 empty | 🟡 partial | = | 401 (no 500). | Re-test with auth. → Task #53 | NICE-500-01 |
| `/api/calendar/events` → 200 empty | 🟡 partial | = | 401. | Re-test with auth. → Task #53 | NICE-500-01 |
| `/api/financials/:projectId` → 200 default | 🟡 partial | = | 401. | Re-test with auth. → Task #53 | NICE-500-02 |
| `/api/progress/metrics/:projectId` → 200 default | 🟡 partial | = | 401. | Re-test with auth. → Task #53 | NICE-500-02 |
| `/api/wellbeing/checkins` POST → 201 | 🟡 partial | = | Write path present; not exercised. | Integration test. → Task #53 | NICE-500-03 |
| `/api/deals` / `/api/projects` → 200 empty | 🟡 partial | = | 307 (trailing-slash), not a 500. | Resolve with auth. → Task #53 | NICE-500-01 |
| `/api/projects/:id` → 404 for missing | 🟡 partial | = | 401 (auth gate before lookup). | Verify 404 contract under auth. → Task #53 | NICE-500-04 |
| `/api/partnernet/summary`, `/api/capital/portfolio`, `/api/monitoring/analytics/overview`, `/api/infra/queue` | 🟡 partial | = | 401 (no 500). | Re-test with (admin) auth. → Task #53 | NICE-500-01 |
| `/api/pipeline/active` → 200 on empty | 🟡 partial | = | Worker `pipeline.get('/active')` shipped (prod path green). Dev FastAPI still **404** — `main.py` mounts only `pipeline_votes` (`main.py:474`), no `/api/pipeline/active` shim. Dev-mirror gap, not a prod blocker. | Mount the dev FastAPI `/api/pipeline/active` shim. → **Task #52** | BLOCK-500-05 |
| `/api/legalcap/capital/lp-portal` → 200 default | 🟢 green | ⬆️ | Worker `routes/legalcap.ts` present (prod) **and** the dev FastAPI legalcap shim is now mounted in `main.py`. The 06-03 dev-mirror gap is closed. | Done. | BLOCK-500-06 |
| `/api/pipeline/ws/overview`, `/api/onboarding/ws/*` — WS upgrade | 🟡 partial | = | `durable_*` true on `/api/health`; handshake not exercised. (`GET /api/infra/ws-check` now offers an authenticated upgrade spot-check, `infra.ts:479`.) | Spot-check WS. → Task #53 | NICE-500-08 |
| `/api/advisor/explain` → 200 w/ retry/KV | 🟡 partial | = | Route present; 401 unauth. | Re-test with a token + cold/warm cache pair. → Task #53 | NICE-500-07 |

---

## ADVISOR

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Admin persona bank exists | 🟢 green | ⬆️ | `ADMIN_BANK` promoted to a first-class `services/advisor/banks/admin.ts` module with **11** questions (3 PREFS / 4 OVERSIGHT / 2 OPERATIONS / 2 GOVERNANCE), clearing the `admin: 10` drift size target and flowing through the manifest generator. | Done. | NICE-ADV-01 |
| Repeat-question test passes | 🟢 green | ⬆️ | Two layers: the state machine drops already-answered ids **cross-conversation** (`loadAnsweredForUser` + `pickNext`) with a 5-min anti-repeat penalty; and it is tested — `advisor.scenarios.test.ts` asserts the "zero repeats — same id never surfaces twice" invariant (in `test:drift`), plus a dedicated `advisor.stateMachine.test.ts` "Task #12 (BLOCK-ADV-02) — repeat-question regression" (answered id deduped + never re-served + peer served). | Done. | BLOCK-ADV-02 |
| Workers AI per turn — model + latency | 🟡 partial | = | `runAdvisorTurn()` returns model + provider via SSE. | Capture SSE under auth. → Task #53 | NICE-ADV-03 |
| AI Gateway slug `advisor-ongoing` | 🟡 partial | = | Code injects the gateway id for advisor tasks; the dashboard slug is operator-created. | **Operator:** create `advisor-ongoing` gateway in the CF dashboard. | BLOCK-ADV-04 |
| Free-form question handled | 🟡 partial | = | `/api/advisor/explain` present; auth-gated. | Re-test with auth. → Task #53 | NICE-ADV-05 |
| Tool-call rate-limit enforced | 🟡 partial | = | KV daily turn cap exists; per-second burst guard not separately verified. | Add burst guard or document the daily cap as sole limiter. → Task #53 | NICE-ADV-06 |
| Dynamic question generator (`dyn.*`) | 🟢 green | ⬆️ | `stateMachine.ts:390` `generateDynamicQuestion()` emits a persona-aware `dyn.reflect.N` reflection when the bank is exhausted; `nextTurn()` serves it and only one is live at a time (N advances on answer/skip). Persisted to the `users.advisor_extras_json` sidecar. | Done. | BLOCK-ADV-07 |

---

## CONTRACTS / TRUST

| Row | Status | Δ | Observed | Next action | Issue |
|---|---|---|---|---|---|
| Admin > Contracts union | 🟢 green | = | `routes/admin_contracts.ts` mounted (now `requireStepUp`-gated); `test/admin_contracts_union.test.mjs`. | — | — |
| Pairwise NDAs visible | 🟡 partial | = | `services/trustEnvelope.ts` references `pairwise_ndas`; prod D1 shape not confirmed in this read-only pass. Worker `ensureTrustSchema()` `CREATE TABLE IF NOT EXISTS` self-heals on first hit regardless. | **Operator:** read-only `SELECT name FROM sqlite_master WHERE name='pairwise_ndas'` on prod D1; flip green if present. | NICE-TRUST-01 |
| Sanctions screening live | 🟢 green | = | `services/sanctions.ts` + `test/sanctions_match.test.mjs`. | — | — |
| Founder ↔ Investor 3-way NDA | 🟢 green | = | `services/trustEnvelope.ts` three-party envelopes; `test/trust_intro.test.mjs`. | — | — |

---

## INTEGRATIONS

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Stripe Connect OAuth round-trip | 🟡 partial | = | `integrations/providers/stripe.ts` present; no live round-trip test. | **Operator:** manual round-trip + capture redirect. | NICE-INT-01 |
| Stripe MRR → live financials | 🟢 green | ⬆️ | `computeStripeMetrics()` → `projectMetricsToProject()` writes a `metrics_snapshots` row tagged **`source='stripe'`** (`stripe.ts:336`) **and** upserts `financial_models.assumptions_json` (mrr/arr/paying_customers/monthly_churn_pct with `_sources: 'stripe'`). Anti-cheat: >20% divergence vs self-reported snapshot inserts a `metric_anomalies` row. *(Implementation records the source via `metrics_snapshots.source` + the `assumptions_json._sources` map rather than a `financial_models.source` column — same intent as the 06-03 spec.)* | Done. | BLOCK-INT-02 |
| Google Calendar / Outlook OAuth | 🟢 green | = | `services/calendar.ts`; refresh tokens encrypted at rest. | — | — |
| LinkedIn OAuth redirect URI = `axal.vc` | 🟡 partial | ⬆️ | `redirect_uri` is now derived via `callbackBase()` (`util/url.ts`) — pinned to `app.axal.vc` (a real Axal domain, not `workers.dev`) by `OAUTH_CALLBACK_BASE_URL` until provider dashboards are updated. Full convergence to `axal.vc` is an operator step. | **Operator:** update provider redirect-URI registrations, then delete `OAUTH_CALLBACK_BASE_URL`. | NICE-INT-03 |
| HubSpot/Carta/Affinity/DocuSign tiles | 🟡 partial | = | HubSpot + DocuSign present; Carta/Affinity not re-confirmed this pass. | Audit `IntegrationsPage.jsx` provider list (low priority). | NICE-INT-04 |

---

## MARKETING / PUBLIC

App-owned marketing routes are now carved to the Worker/SPA in **both** `wrangler.toml` route blocks (exact + `/*`). Graded 🟢 by config inspection; they go live on `npm run deploy` and were not re-verified via live `curl` in this read-only pass.

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Front-page / public-surface decision | 🟢 green | ⬆️ | Decision recorded (`replit.md`): the SPA is the public surface for app-owned routes; Jekyll keeps the apex root and any unrouted path. | Jekyll root copy remains marketing/operator-owned. | BLOCK-MKT-01 |
| `/spinout-lab` expansion | 🟢 green | ⬆️ | Apex-routed to the Worker/SPA in both blocks (`wrangler.toml:143`, `:666`). Binds on deploy. | Confirm live post-deploy. | BLOCK-MKT-02 |
| `/about` — Guillaume's card | 🟢 green | ⬆️ | Apex-routed (`:149`, `:672`); reuses `TeamPage`; `/team` 301s to `/about`. | Confirm live post-deploy. | BLOCK-MKT-03 |
| `/insights` — seed articles | 🟢 green | ⬆️ | Apex-routed (`:155`, `:678`); self-contained index over `GET /api/market-intel-public/publications` (published + non-internal); cards deep-link `/insights/public/:slug`. | Confirm live post-deploy. | BLOCK-MKT-04 |
| `/directory` — public list | 🟢 green | ⬆️ | Apex-routed (`:161`, `:684`). | Confirm live post-deploy. | BLOCK-MKT-05 |
| Hero — drop "Three lanes —" prefix | 🟡 partial | = | The apex root hero is Jekyll copy, edited in the marketing (Pages) repo, not this repo. | **Operator/marketing:** update the Jekyll hero copy. | BLOCK-MKT-06 |
| Contact form → GitHub Issue round-trip | 🟢 green | = | `routes/tickets.ts` creates an issue via the GitHub API + reads back comments (`github_issue_number`/`_url` columns). `/contact` is now apex-routed (`:167`, `:690`) so the public contact page is reachable. Closed at 2026-06-03. | — | NICE-MKT-07 |

---

## ADMIN UX

| Row | Status | Δ | Observed | Next action | Issue |
|---|---|---|---|---|---|
| FOUNDER_ID + PARTNER_ID generated | 🟢 green | = | `services/publicIds.ts` + `routes/esign.ts`/`admin.ts`. | **Operator:** confirm backfill on prod D1 (read-only count). | NICE-ADM-01 |
| `users.last_active_at` populated | 🟢 green | = | `middleware/lastActive.ts` mounted. | — | — |
| Admin onboarding transcripts visible | 🟡 partial | = | `routes/admin.ts` present; UI not verified. | UI walkthrough as admin. → Task #53 | NICE-ADM-02 |
| Admin ongoing advisor transcripts | 🟡 partial | = | `routes/admin_advisor_audit.ts` exists; UI tab not inspected. | UI walkthrough as admin. → Task #53 | NICE-ADM-02 |

---

## PAYMENTS

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Stripe checkout end-to-end (test) | 🟡 partial | = | `routes/billing.ts` handles checkout + webhooks; live round-trip not run. | **Operator:** run test-mode checkout end-to-end. | NICE-PAY-01 |
| Tier flips on `subscription.created` / `.deleted` | 🟢 green | = | `routes/billing.ts` handles created/updated/deleted. | — | — |
| Refund flow (admin → Stripe refund) | 🟢 green | ⬆️ | `routes/admin_billing.ts:182` — step-up-gated admin refund route calls `stripeCall(env, '/refunds', …)` (no SDK in the Worker). Per-product refund policy encoded (incorporation: no refund once filing has begun; session booking window; subscription: prorated) plus an audit row. | Done. | BLOCK-PAY-02 |
| Free-tier paywall — 402 + upgrade UI | 🟢 green | = | `PaywallModal.jsx` + `openPaywall(lockTier)`. | — | — |

---

## SETTINGS

All tab rows remain 🟡 pending a UI walkthrough (unchanged from 2026-06-03); Appearance is 🟢 (theme persists via `SettingsContext`). Rolled into the 5-persona walkthrough. → **Task #53** · NICE-SET-01.

---

## SECURITY HEADERS

Unchanged from 2026-06-03 — all 🟢: CSP (nonce + strict-dynamic), HSTS (`max-age=63072000; includeSubDomains; preload`), `x-frame-options: DENY`, `referrer-policy: no-referrer` (canonical for the app/API surface; NICE-SEC-01 resolved — the public Jekyll site keeps `strict-origin-when-cross-origin`). Extras still present: COOP `same-origin`, CORP `same-site`, full `permissions-policy`, `x-content-type-options: nosniff`.

---

## OPS

| Row | Status | Δ | Observed (2026-07-03) | Next action | Issue |
|---|---|---|---|---|---|
| Tail Worker forwarding to R2 | 🟢 green | = | `[[tail_consumers]] service = "studioos-tail"`. | **Operator:** confirm R2 has recent objects. | — |
| DLQ exists + visible + retry | 🟢 green | ⬆️ | `GET /api/infra/dlq` UNIONs the D1 `dead_letter_queue` and the `cf_dlq_mirror`; the 06-03 follow-up — a **retry action** — now ships: `POST /api/infra/dlq/:id/retry` (`infra.ts:277`, re-enqueues with a fresh idempotency key) + `DELETE /api/infra/dlq/:id`, both `?source=d1|cf` disambiguated. | Done. | BLOCK-OPS-02 |
| `/api/health` deep check | 🟢 green | = | All bindings green. | — | — |
| Cron triggers — last-run / next-run surface | 🟢 green | ⬆️ | `GET /api/infra/cron-history` (`infra.ts:375`) returns per-trigger `last_run_at` (from `cron_run_history`) + a computed `next_run_at` (`nextCronRun()` over `CRON_TRIGGERS`); `POST /api/infra/cron-log` records runs. | Done. | NICE-OPS-03 |
| Workers Traces enabled | 🟢 green | ⬆️ | `wrangler.toml` `[observability.traces] enabled = true` (`:564`); logs also `true`. Binds on deploy. | Done. | BLOCK-OPS-04 |

---

## ICP walkthroughs — now UNBLOCKED

The 2026-06-03 audit deferred the 5-ICP walkthrough (`BLOCK-WALKTHROUGH-01`) because prod magic-link + passkey were 🔴. **Both are now 🟢**, so real prod sign-up across all five personas is unblocked. The walkthrough — plus the parked authenticated `NICE-500-*` / advisor `/explain` / Settings-tab re-tests — is carried by sibling **Task #53**.

---

## Punch list — red/partial rows grouped by owning PR (2026-07-03)

### IB — Auth + Notifications
- ✅ BLOCK-AUTH-01 magic-link · ✅ BLOCK-AUTH-02 passkeys · ✅ BLOCK-AUTH-03 general step-up — **all shipped this cycle**
- NICE-AUTH-04 — reconcile `/sessions/revoke-all` (+ new `/api/auth/revoke-all` alias) ↔ `/sign-out-everywhere` naming → **Task #52**

### IC — Empty/Error/Mobile/A11y
- NICE-500-03 wellbeing POST test · NICE-500-04 `/api/projects/:id` 404 contract · NICE-SET-01 Settings tabs → **Task #53**
- BLOCK-WALKTHROUGH-01 — 5-ICP walkthrough (now unblocked) → **Task #53**

### ID — Public Marketing
- ✅ BLOCK-MKT-01/-02/-03/-04/-05 — decision + apex routes for `/spinout-lab`, `/about`, `/insights`, `/directory` (+`/contact`, `/articles`) shipped; **live on next deploy**
- BLOCK-MKT-06 — drop "Three lanes —" Jekyll hero prefix → **operator/marketing**

### IE — Ops / Observability
- ✅ BLOCK-OPS-02 DLQ retry · ✅ BLOCK-OPS-04 Workers Traces · ✅ NICE-OPS-03 cron last/next-run — **all shipped this cycle**
- NICE-500-08 — WS upgrade spot-check (`/api/infra/ws-check` available) → **Task #53**

### IF — Onboarding Checklist
- ✅ BLOCK-500-06 legalcap dev shim — **shipped**
- BLOCK-500-05 — `/api/pipeline/active` dev FastAPI shim (Worker route already shipped; dev mirror missing) → **Task #52**

### IG — Admin UX
- NICE-ADM-02 — Admin Onboarding + Ongoing advisor transcripts UI walkthrough → **Task #53**
- NICE-ADM-01 — confirm FOUNDER_ID / PARTNER_ID backfill on prod D1 → **operator**

### IH — Integrations data pulls
- ✅ BLOCK-INT-02 Stripe MRR → live financials — **shipped**
- NICE-INT-01 Stripe Connect round-trip (**operator**) · NICE-INT-03 LinkedIn redirect URI → `axal.vc` (**operator**: provider dashboards + delete `OAUTH_CALLBACK_BASE_URL`) · NICE-INT-04 provider tiles audit (low priority)

### II — Payments
- ✅ BLOCK-PAY-02 refund flow — **shipped**
- NICE-PAY-01 — Stripe test-mode checkout end-to-end → **operator**

### Advisor track
- ✅ BLOCK-ADV-02 repeat-question test · ✅ BLOCK-ADV-07 dynamic generator · ✅ NICE-ADV-01 ADMIN_BANK expanded — **all shipped this cycle**
- BLOCK-ADV-04 — create `advisor-ongoing` AI Gateway slug → **operator**
- NICE-ADV-03 SSE transcript · NICE-ADV-05 free-form `/explain` smoke · NICE-ADV-06 per-second burst guard → **Task #53**

### Trust / Sec
- NICE-TRUST-01 — confirm `pairwise_ndas` on prod D1 → **operator** (Worker self-heals regardless)
- NICE-SEC-01 — ✅ resolved (2026-06-03): two-tier referrer policy documented

---

## Close list — shipped since 2026-06-03 (eligible to close)

| Issue | What shipped | Evidence |
|---|---|---|
| **BLOCK-AUTH-01** | Magic-link passwordless sign-in/up on the Worker | `auth.ts:902` `/magic/start`, `:947` `/magic/verify`; `magic_link_tokens` table; `factor='magic'` lower-assurance session |
| **BLOCK-AUTH-02** | Passkey (WebAuthn) registration + assertion | `routes/auth_passkey.ts` + `util/webauthn.ts`; satisfies step-up |
| **BLOCK-AUTH-03** | General `requireStepUp` on admin + payments | `auth.ts:531`; applied in `admin.ts`, `admin_billing.ts`, `admin_promos.ts`, `admin_contracts.ts`, `dd.ts`, `kyc.ts`, `billing.ts` |
| **BLOCK-ADV-02** | Repeat-question regression test | `advisor.scenarios.test.ts` zero-repeats invariant (in `test:drift`) + `advisor.stateMachine.test.ts` dedicated regression |
| **BLOCK-ADV-07** | Dynamic reflection generator for exhausted banks | `stateMachine.ts:390` `generateDynamicQuestion()` → `dyn.reflect.N` |
| **NICE-ADV-01** | `ADMIN_BANK` expanded to 11 questions (target ≥10) | `services/advisor/banks/admin.ts` (first-class bank) |
| **BLOCK-INT-02** | Stripe MRR → live financials | `stripe.ts:336` `metrics_snapshots(source='stripe')` + `financial_models.assumptions_json` (+ `metric_anomalies` anti-cheat) |
| **BLOCK-PAY-02** | Admin refund flow → Stripe | `admin_billing.ts:182` step-up-gated route → `stripeCall('/refunds')` + per-product policy + audit row |
| **BLOCK-OPS-02** | DLQ retry action (06-03 follow-up) | `infra.ts:277` `POST /dlq/:id/retry` + `DELETE /dlq/:id`, `?source=d1\|cf` |
| **NICE-OPS-03** | Cron last-run / next-run surface | `infra.ts:375` `GET /api/infra/cron-history` (`nextCronRun()` + `cron_run_history`) |
| **BLOCK-OPS-04** | Workers Traces enabled | `wrangler.toml:564` `[observability.traces] enabled = true` |
| **BLOCK-500-06** | legalcap dev FastAPI shim | mounted in `backend/app/main.py` (prod Worker `routes/legalcap.ts` already present) |
| **BLOCK-MKT-01/-02/-03/-04/-05** | Public-surface decision + apex marketing routes | both `wrangler.toml` route blocks (`:143`+, `:666`+); live on `npm run deploy` |

**Partial / not yet closeable:** NICE-AUTH-04 (naming reconciliation) & BLOCK-500-05 (dev pipeline shim) → **Task #52**. Authenticated re-tests + 5-persona walkthrough → **Task #53**. Operator-only: BLOCK-ADV-04, BLOCK-MKT-06, NICE-INT-01/-03/-04, NICE-PAY-01, NICE-TRUST-01, NICE-ADM-01.

---

## Filing & closing

Unlike prior cycles, this environment now has **write access** to `AxalNetwork/StudioOS` (a `GITHUB_TOKEN` with `repo` + `workflow` scopes). The `BLOCK-*` / `NICE-*` ids remain paste-ready bodies in `BETA_READINESS_ISSUES_2026-05-20.md` and were never filed as individual GitHub issues, so there are no per-item issue numbers to close — they are tracked via this audit's Close list above. The only real GitHub issue is the tracking issue **#124** (`Beta Readiness re-audit — 2026-07-03`).

**Action taken by this audit:** commented on and closed tracking issue **#124**, pointing at this file as the new ground truth and naming the residuals carried by sibling Tasks #52 (dev pipeline shim + revoke-all naming) and #53 (5-persona walkthrough + authenticated re-tests), plus the operator-only items.

---

## Re-audit schedule

`.github/workflows/beta-readiness-reaudit.yml` fires again on **2026-07-17** (cron `0 9 3,17 * *`) and opens a fresh tracking issue referencing the latest `BETA_READINESS_AUDIT_*.md` (this file) for the next hand-off.
