# Beta Readiness — Paste-Ready GitHub Issues (2026-05-20)

The GitHub integration was not connected when Task #1 (IJ Bug Bash Audit) ran, so these issue bodies are staged here for paste-into-`gh issue create` (or for the next agent with the integration connected). Labels: `beta-blocker` for `BLOCK-*`, `beta-nice` for `NICE-*`. All reference `BETA_READINESS_AUDIT_2026-05-20.md`.

---

## BLOCK-AUTH-01 — Ship `/api/auth/magic/start` on the Worker
**Labels:** `beta-blocker`, `auth`, `worker`
`POST https://axal.vc/api/auth/magic/start` returns 404 in prod. The route is not mounted in `cloudflare-worker/src/index.ts` and no `magic/start` handler exists in `cloudflare-worker/src/routes/auth.ts`. Ship the passwordless email-link start + verify endpoints and wire them into `frontend/src/pages/LoginPage.jsx`. Owning PR: IB.

## BLOCK-AUTH-02 — Ship Passkey (WebAuthn) registration on the Worker
**Labels:** `beta-blocker`, `auth`, `worker`
`GET /api/auth/passkey/register-options` and `/registration-options` both 404 in prod. Add WebAuthn registration options + verification + assertion routes on the Worker, persisted in a `passkeys` table. Owning PR: IB.

## BLOCK-AUTH-03 — Step-up authentication middleware
**Labels:** `beta-blocker`, `auth`, `security`
`rg "step.up|stepUp|recent.*auth"` in `cloudflare-worker/src/middleware/` returns 0 hits. Implement `requireStepUp(ttlMinutes)` and apply to admin endpoints + payment/refund + KYC. Owning PR: IB.

## NICE-AUTH-04 — Reconcile `/sign-out-everywhere` ↔ `/sessions/revoke-all`
**Labels:** `beta-nice`, `auth`, `docs`
The spec row asks for `/api/auth/sign-out-everywhere`; the implementation is `POST /api/settings/sessions/revoke-all` (`cloudflare-worker/src/routes/settings.ts:489`, bumps `users.jwt_min_iat`). Either rename to match the spec or update the spec/docs. Owning PR: IB.

## NICE-500-01 — Re-run empty-state checks under auth
**Labels:** `beta-nice`, `dx`
The following routes returned 401 (no 500, route present) but couldn't be exercised end-to-end without a session: `/api/integrations`, `/api/calendar/events`, `/api/deals`, `/api/projects`, `/api/partnernet/summary`, `/api/capital/portfolio`, `/api/monitoring/analytics/overview`, `/api/infra/queue`. Re-test with auth in IB and confirm each returns a 200 hydrated default. Owning PR: IB.

## NICE-500-02 — Re-test hydrated defaults for `/api/financials/:id` and `/api/progress/metrics/:id`
**Labels:** `beta-nice`, `dx`
Both returned 401 in dev unauth. Re-test with auth + a non-existent project id; confirm the "hydrate default model" branch fires (not 500). Owning PR: IB.

## NICE-500-03 — Add wellbeing checkins integration test
**Labels:** `beta-nice`, `tests`
`POST /api/wellbeing/checkins` was not exercised (write path). Add an authenticated 201 test. Owning PR: IC.

## NICE-500-04 — Verify `/api/projects/:id` returns 404 (not 500) for missing
**Labels:** `beta-nice`, `dx`
401 fires before lookup in dev. Re-test with auth + a non-existent id. Owning PR: IC.

## BLOCK-500-05 — `/api/pipeline/active` 404 on dev FastAPI
**Labels:** `beta-blocker`, `backend`
`GET http://localhost:8000/api/pipeline/active` → 404. The route is not mounted (backend only ships `pipeline_votes.py`). Either implement it or remove it from the error-dashboard checklist. Owning PR: IF.

## BLOCK-500-06 — `/api/legalcap/capital/lp-portal` 404 on dev FastAPI
**Labels:** `beta-blocker`, `backend`
`GET http://localhost:8000/api/legalcap/capital/lp-portal` → 404. The Worker has `routes/legalcap.ts` but the FastAPI prefix is not mounted here. Mount the shim or align the dashboard URL with the Worker path. Owning PR: IF.

## NICE-500-07 — Capture `/api/advisor/explain` SSE under auth (cold + warm cache)
**Labels:** `beta-nice`, `advisor`
Route returns 401 unauth. Re-test with auth; capture an SSE transcript and confirm the `event: provider {model, provider, fallback_used, cached}` beat fires on both cold and warm calls. Owning PR: IB.

## NICE-ADV-01 — Expand `ADMIN_BANK` beyond the single stub question
**Labels:** `beta-nice`, `advisor`
`cloudflare-worker/src/services/advisor/questionBank.ts:168-174` defines `ADMIN_BANK` with only 1 question (`admin.preferences.digest_freq`). Expand to ≥10 admin-relevant questions.

## BLOCK-ADV-02 — Add advisor repeat-question regression test
**Labels:** `beta-blocker`, `tests`, `advisor`
No `advisor.repeat` test exists under `cloudflare-worker/test/`. Add a test that asks the same question id twice in a session and asserts dedupe + cached follow-up.

## NICE-ADV-03 — Verify Workers AI model + latency surface in advisor turn response
**Labels:** `beta-nice`, `advisor`
Code path (`services/advisor/aiClient.ts`) emits `event: provider {model, provider, fallback_used, cached}` per `replit.md`. Capture a live SSE transcript to confirm.

## BLOCK-ADV-04 — Create `advisor-ongoing` AI Gateway slug in CF dashboard
**Labels:** `beta-blocker`, `ops`, `advisor`
`replit.md` flags this as an operator action: until the gateway exists, advisor calls fall through un-gatewayed (no per-slug spend / cache analytics). Create the gateway (slug `advisor-ongoing`, cache TTL 5m for explainers / 0 for turns, rate limit 60-rpm/user 200-rpm/account).

## NICE-ADV-05 — Smoke-test `/api/advisor/explain` with "what is TALC?" under auth
**Labels:** `beta-nice`, `advisor`
Confirm the free-form LLM reply path returns sensible text (and `stripVerbatimLeak` doesn't strip the whole reply).

## NICE-ADV-06 — Burst rate-limit on advisor tool calls
**Labels:** `beta-nice`, `advisor`, `security`
The KV daily turn cap exists but no per-second burst guard is documented. Either add one or document the daily cap as the only limiter.

## BLOCK-ADV-07 — Dynamic question generator (`dyn.*`)
**Labels:** `beta-blocker`, `advisor`
`rg "dyn\.|generateDynamic|dynamic.*question"` in `cloudflare-worker/src/services/advisor/` returns 0 hits. Implement a fallback generator that fires when the persona bank is exhausted.

## NICE-TRUST-01 — Confirm `pairwise_ndas` exists on prod D1 (not just dev)
**Labels:** `beta-nice`, `trust`, `db`
`replit.md` mentions a dev-only `dev_pairwise_ndas` table. Run a read-only `SELECT name FROM sqlite_master WHERE type='table' AND name='pairwise_ndas'` on prod D1.

## NICE-INT-01 — Stripe Connect OAuth live round-trip
**Labels:** `beta-nice`, `integrations`
Code present in `cloudflare-worker/src/integrations/providers/stripe.ts`; no live round-trip captured. Run one in dev and attach screenshots/log.

## BLOCK-INT-02 — Stripe MRR → `financial_models.source='stripe'`
**Labels:** `beta-blocker`, `integrations`, `financials`
No `source='stripe'` write path found in `cloudflare-worker/src/routes/financials.ts`. Wire the Stripe MRR pull into the financials model. Owning PR: IH.

## NICE-INT-03 — LinkedIn OAuth redirect URI audit
**Labels:** `beta-nice`, `integrations`
Confirm `cloudflare-worker/src/routes/linkedin.ts` uses `axal.vc` and not a `*.workers.dev` host.

## NICE-INT-04 — Audit Integrations page provider tiles
**Labels:** `beta-nice`, `integrations`, `frontend`
Confirm HubSpot, Carta, Affinity, DocuSign all render as tiles on `frontend/src/pages/IntegrationsPage.jsx`.

## BLOCK-MKT-01 — Decide Jekyll vs SPA as public origin + refresh front-page copy
**Labels:** `beta-blocker`, `marketing`
`axal.vc/` is currently the GitHub Pages Jekyll site (`x-github-request-id` on response). The React `LandingPage.jsx` is not the public surface. Pick one and republish with engines/layers/lanes copy. Owning PR: ID.

## BLOCK-MKT-02 — Publish `/spinout-lab` on the public origin
**Labels:** `beta-blocker`, `marketing`
`curl https://axal.vc/spinout-lab` → 404. SPA has `SpinoutLabPage.jsx`; not reachable publicly. Owning PR: ID.

## BLOCK-MKT-03 — Publish `/about` (Guillaume's card)
**Labels:** `beta-blocker`, `marketing`
`curl https://axal.vc/about` → 404. Owning PR: ID.

## BLOCK-MKT-04 — Publish `/insights`
**Labels:** `beta-blocker`, `marketing`
`curl https://axal.vc/insights` → 404. Owning PR: ID.

## BLOCK-MKT-05 — Publish `/directory`
**Labels:** `beta-blocker`, `marketing`
`curl https://axal.vc/directory` → 404. Owning PR: ID.

## BLOCK-MKT-06 — Drop "Three lanes —" prefix from hero
**Labels:** `beta-blocker`, `marketing`
Jekyll `<title>` is still `Global Venture Partner Network — One network. Three lanes.` Update copy per ID. Owning PR: ID.

## NICE-MKT-07 — Confirm contact form → GitHub Issue round-trip
**Labels:** `beta-nice`, `marketing`
`cloudflare-worker/src/routes/tickets.ts` exists; confirm submissions create GitHub Issues via the configured app token. Owning PR: ID.

## NICE-ADM-01 — Backfill check for `users.founder_public_id` / `partner_public_id`
**Labels:** `beta-nice`, `admin`, `db`
Run a read-only `SELECT COUNT(*) FROM users WHERE founder_public_id IS NULL AND role='founder'` on prod D1.

## NICE-ADM-02 — Admin UI walkthrough: Onboarding tab + Ongoing advisor transcripts
**Labels:** `beta-nice`, `admin`, `ux`
Confirm `/admin/users/:id` renders both an Onboarding tab and an Ongoing advisor transcripts tab. Owning PR: IG.

## NICE-PAY-01 — Stripe test-mode checkout end-to-end
**Labels:** `beta-nice`, `payments`
Run one full checkout in test mode and confirm tier flip + receipt email. Owning PR: II.

## BLOCK-PAY-02 — Admin refund endpoint
**Labels:** `beta-blocker`, `payments`, `admin`
`rg "refund" cloudflare-worker/src/routes/billing.ts` → 0 hits. Implement `POST /api/admin/billing/refund` that calls `stripe.refunds.create` and writes an audit row. Owning PR: II.

## NICE-SET-01 — UI walkthrough of every Settings tab
**Labels:** `beta-nice`, `settings`, `ux`
Walk Identity / Details / Legal entity / Digest & quiet hours / Visibility / Integrations / Developer / Appearance — save + reload, capture any 500 or stale-state. Owning PR: IC.

## NICE-SEC-01 — Reconcile `Referrer-Policy: no-referrer` with spec
**Labels:** `beta-nice`, `security`, `docs`
Observed `referrer-policy: no-referrer`; spec calls for `strict-origin-when-cross-origin`. `no-referrer` is stricter but disagrees with the checklist — decide which is canonical and update the loser.

## BLOCK-OPS-02 — DLQ admin panel surface
**Labels:** `beta-blocker`, `ops`, `admin`
`wrangler.toml:176-177` (mirrored at `:367-368`) wires `studioos-job-queue` to `dead_letter_queue = "studioos-job-queue-dlq"` with `max_retries = 3`. Queue plumbing lives in `cloudflare-worker/src/queue-consumer.ts` + `services/queue.ts`. **However**, no admin route exposes DLQ contents (`rg "dlq" cloudflare-worker/src/routes/admin*.ts` → 0 hits). Add a route + UI surface listing DLQ items and a retry button. Owning PR: IE.

## BLOCK-OPS-04 — Enable Workers Traces
**Labels:** `beta-blocker`, `ops`
`wrangler.toml:283-286` has `[observability.traces] enabled = false`. Flip to `true` (and mirror under `[env.production.observability.traces]` if needed), redeploy, confirm per-request traces in the CF dashboard. Owning PR: IE.

## NICE-OPS-03 — Surface cron last-run / next-run timestamps in admin
**Labels:** `beta-nice`, `ops`, `admin`
6 crons are declared (`wrangler.toml:263-270`, mirrored at `:413`) but no admin panel exposes their run history. Add a panel pulling from D1 cron-run audit rows (or CF Analytics Engine). Owning PR: IE.

## NICE-500-08 — WS upgrade spot-check (pipeline + onboarding Durable Objects)
**Labels:** `beta-nice`, `dx`, `qa`
`durable_pipeline` and `durable_onboarding` bindings are healthy on `/api/health`, but the full WebSocket upgrade handshake wasn't exercised in this audit (requires auth + `Upgrade: websocket` headers). Run an authenticated WS connect against `/api/pipeline/ws/overview` and `/api/onboarding/ws/*` and capture the upgrade response. Owning PR: IC.

## BLOCK-WALKTHROUGH-01 — 5-ICP sign-up walkthrough (Founder / Investor / Partner / Mentor / Admin)
**Labels:** `beta-blocker`, `qa`
Blocked on BLOCK-AUTH-01 + BLOCK-AUTH-02 (no real prod sign-up today). Once IB lands, run a full walkthrough as each ICP and attach screenshots / console errors. Owning PR: IC.
