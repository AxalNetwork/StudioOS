# Scale audit — first 1,000 daily users

**Date:** 2026-09-18.
**Commit:** `59f83ae82` (`origin/main` at audit time).
**Target:** keep `axal.vc` / `app.axal.vc` (Cloudflare Worker + D1) healthy when
~1,000 people use the platform on a given day, with ~200 authenticated tabs
open at peak.

This file is the implementation brief for Claude Code. Findings are a snapshot.
Re-check line numbers against the tree before editing.

## What this is not

Not checked (do not invent work from these gaps):

- Live D1 row counts, QPS, or Cloudflare dashboard quotas.
- FastAPI `backend/` (Replit-dev only; never production).
- Security review, UX, or canvas delivery (see the other audits).
- Multi-region D1, Hyperdrive, or a second database.
- Whether production has applied every numbered migration.

1,000 DAU is **not** a reason to leave Workers/D1. Paid D1 and a single Worker
script will serve this load if write amplification and a few request-path
footguns are fixed. Do not propose Postgres, Redis, or a rewrite.

## Load model (why the numbers matter)

Assume 1,000 DAU, ~200 concurrent authenticated tabs at peak, 8-hour working
day.

| Source | Steady rate | Why it hurts |
| --- | --- | --- |
| `NotificationBell` poll, 30s, every shell tab | **~6.7 HTTP req/s** | Linear in open tabs, including background tabs |
| Same poll × 2 D1 writes via observability | **~13 D1 writes/s** | `system_metrics` + `activity_logs` on a read |
| Dashboard first paint (founder) | **22–28 HTTP** + 2 WebSockets | Burst on navigation, not sustained |
| `GET /api/auth/me` | ~0 steady (5 min throttle) | Duplicate D1 on every *other* authenticated call |
| Global rate-limit bucket | **1,000 req/min** | Saturates at ~250 tabs polling at 30s |

A quiet 1,000-DAU day of *real* product use is tens of thousands of API
calls. The notification poll alone, if tabs stay open 8 hours, is on the
order of **200k GETs/day**. That is the first bottleneck, not CPU.

---

## Verdict

The architecture is viable at 1,000 DAU. The Worker already has KV dashboard
cache, CF Queues, hibernatable Durable Objects, per-user AI caps, and
pagination on several admin lists.

What will fail **before** the database does:

1. The **global 1,000 req/min** KV bucket 429s legitimate users once a few
   hundred tabs are polling.
2. Observability writes **two D1 rows per API request**, including the 30s
   unread-count poll.
3. Cold isolates run **role-schema bootstraps on the request path** (15–45 D1
   round-trips; worst case a `users` table rebuild).
4. `getCurrentUser` does `SELECT * FROM users` and **`requireAuth` ignores the
   user already cached by rate-limit middleware**.

Fix Phases 0–2 before inviting 1,000 daily users. Phases 3–5 are hygiene so
the same design still works at a few thousand DAU.

---

## Do not

Claude Code must not:

- Change `wrangler.toml` `main`, add path-scoped `axal.vc/*` routes, or edit
  `docs/` by hand.
- `ALTER TABLE users ADD COLUMN` (D1 column ceiling; use a side table).
- `SELECT * FROM users` joined to anything (D1 result-set column cap).
- Put `BEGIN;` / `COMMIT;` in a migration.
- Add a polling interval without pausing when `document.hidden`.
- Raise AI budgets, the advisor daily turn cap, or the global rate limit
  without also cutting poll traffic.
- “Fix” `workflow_tasks` assignment (GOTCHAS: inert by product decision).
- Port behaviour only to FastAPI. Production is the Worker.
- Provision `AI_SPEND` KV as a prerequisite for 1,000 DAU (optional, Phase 5).

---

## Findings (re-checked in tree)

### P0 — will 429 or melt D1 writes at a few hundred concurrent tabs

**P0.1 Global rate-limit bucket is 1,000 req/min.**
`cloudflare-worker/src/middleware/rateLimit.ts` (~225–232). Applies to every
`/api/*` request. Comment at ~148–149 assumes dashboard polling never trips
the per-IP 200/min cap; it never mentions that the *global* cap is smaller
than 200 tabs × 2 polls/min. Per-user 60/min is fine. The global bucket is
the false ceiling.

**P0.2 Observability writes D1 on polled reads.**
`cloudflare-worker/src/middleware/observability.ts` (~6–18). Skip lists omit
`/api/notifications/unread-count` and `/api/dashboard` (only `/stats`). Each
poll therefore inserts `system_metrics` and `activity_logs`. `/api/monitoring/`
is skipped *because* polling would infinite-churn; the bell poll was never
added to the same list.

**P0.3 NotificationBell polls every 30s and ignores Page Visibility.**
`frontend/src/components/NotificationBell.jsx` (~88–93). Also opens a **second**
raw WebSocket to `/api/pipeline/ws/overview` (~97–130) even though
`PipelinePage` already uses `useWebSocket` for the same room.

**P0.4 Duplicate `getCurrentUser` per authenticated request.**
`rateLimit.ts` caches the user on context (~307). `requireAuth` in `auth.ts`
(~432–435) always calls `getCurrentUser` again. `/api/auth/me` is
rate-limit-exempt (~244–251), so that path never even populates the cache.
Each `getCurrentUser` does `SELECT * FROM users` plus MI Pro plus
`super_admins` plus session touch (`auth.ts` ~296–375).

### P1 — tail latency and cost, not an outage at 1,000 DAU

**P1.1 Blocking role-schema bootstrap on most `/api/*`.**
`cloudflare-worker/src/index.ts` fetch handler. `ensureInvestorSchema` /
`ensureAdvisorSchema` / `ensureExploringSchema` run before Hono when
`requiresBlockingRoleSchemaBootstrap()` is true. `/api/auth/me` is not
exempt. GOTCHAS already calls this a latent scaling hazard: ~15–20 sequential
D1 round-trips on a cold isolate, and `rebuildUsersRoleCheckFor*` can rebuild
the entire `users` table.

**P1.2 `SELECT * FROM users` on the auth hot path.**
`auth.ts` ~302. `users` is at D1’s ALTER column limit. Auth only needs a
narrow column list; MI Pro and super-admin already hydrate from side tables.

**P1.3 Dashboard origin fan-out.**
`cloudflare-worker/src/routes/dashboard.ts` (~12–19, ~49+). L1 10s + KV 60s is
good. A miss still runs ~15 parallel D1 queries. Founder studio home then
fires another ~9 client calls. Fine at 1,000 DAU if cache hits; painful on
deploy/cold-cache stampedes.

**P1.4 Unbounded lists.**
No `clampLimit` on: privileged project lists (`routes/projects.ts`), events
home (`routes/events.ts`), all IC meetings (`routes/calendar.ts`), advisor
conversation messages (`routes/advisor.ts`). Admin/activity already use
`util/pagination.ts` (max 200).

**P1.5 Calendar / advisor N+1.**
`services/calendar.ts` and `routes/calendar.ts` look up attendees per meeting.
`routes/advisors.ts` `takenForSlot()` COUNTs per slot. Add
`idx_advisor_bookings_slot_status` and batch the COUNT.

**P1.6 Other pollers without visibility pause.**
`CustomerChatWidget.jsx` 20s; `MonitoringPage.jsx` 15s; `InfrastructureTab.jsx`
10s; `LiquidityPage.jsx` 15s; `AdminDueDiligenceCasePage.jsx` 2.5s while
scanning; `useIncorporationStatus.js` 5s. Admin pollers are few users; still
pause when hidden. DD 2.5s is too hot.

### P2 — keep working past 1,000 DAU

**P2.1 Activity feed `OR LOWER(actor) = LOWER(?)`.**
`routes/activity.ts`. Index on `user_id` cannot cover the email leg.
Observability writes are feeding this table (P0.2). Drop the OR once legacy
rows are unused, or keep a dedicated backfill-only path.

**P2.2 Cron density.**
`index.ts` `scheduled()` every minute: queue drain, digest (500 users/tick),
hourly Vectorize re-embed (comment in tree already warns of D1 saturation).
Stagger; push re-embed through `JOB_QUEUE` rather than inline SELECT loops.

**P2.3 Dual queue drain.**
`USE_CF_QUEUE=true` in `wrangler.toml` but cron still `processQueueBatch` on
legacy `queue_jobs`. Leave both until a metric shows the D1 table is empty,
then stop the D1 drain behind the flag.

**P2.4 `ensureInvestorPaywallSchema` still ALTERs `users`.**
`middleware/requireInvestorTier.ts`. Route through
`util/schemaBootstrap.ts` (already the production pattern) or stop calling
ALTER on `users` entirely. Do not add columns to `users`.

**P2.5 Mount burst on studio home.**
Founder dashboard ≈ 22–28 HTTP in 1–2s (`Dashboard.jsx`,
`FounderStudioHome.jsx`, `PersonalAdvisor.jsx`, `ProfileFitSection.jsx`).
Defer advisor history until the rail is expanded; share one
`spinoutLab.state()` / `advisor.progress()` in-flight.

### Fine as-is at 1,000 DAU

- Per-user 60/min and per-IP 200/min buckets.
- Dashboard KV cache keyed by `userId:companyId`.
- `lastActiveMiddleware` KV-throttled 5 min; session `last_seen_at` coalesced
  5 min.
- Advisor 100 turns/day, aiRouter $ caps, queue AI drain 5 jobs/min.
- Durable Objects with hibernatable WebSockets.
- Public articles/news Cache API.
- Funnel `/api/track` (batch 10 / 5s, page cap 50) and `/api/client-error`
  (25/session).
- `useAuthSync` 5 min throttle + in-flight coalescing.

---

## Implementation plan for Claude Code

Implement **in phase order**. Land Phase 0 as one PR if possible. Do not start
Phase 4 until 0–2 are in.

Every change: Worker behaviour in `cloudflare-worker/` first. Frontend
`lib/api.js` only if a new `/api/*` method has a matching Worker route
(`npm run test:drift`). Tests follow the repo’s source-guard style
(`frontend/test/*.mjs` reading files; `cloudflare-worker/test/*.ts`).

### Phase 0 — Stop 429s and write storms

**Task 0.1 — Raise or exclude the global bucket**

Files: `cloudflare-worker/src/middleware/rateLimit.ts`

- Raise `global.limit` from `1000` to **`20000`** (1,000 DAU with polls and
  dashboard bursts still fit; this is a flood ceiling, not a product quota).
- Keep per-user 60/min and per-IP 200/min.
- Add a comment that the old 1,000/min value was smaller than notification
  polling at a few hundred tabs.
- Optionally exclude `GET /api/notifications/unread-count` from the *global*
  bucket only (still counts toward user/IP). Not required if the limit is
  20,000.

Tests: extend the existing rate-limit worker test (search
`cloudflare-worker/test` for `rateLimit` / `global`). Assert the global
limit constant is `>= 10000` and that unread-count is not the only thing
standing between a 429 and a user.

**Task 0.2 — Skip observability on polled GETs**

Files: `cloudflare-worker/src/middleware/observability.ts`

Add to **both** `SKIP_ACTIVITY_LOG_PATHS` and `SKIP_METRICS_PATHS`:

- `/api/notifications/unread-count`
- `/api/dashboard` (prefix, so `/` and `/stats`)
- `/api/auth/me`

Keep writing Analytics Engine datapoints if that path does not touch D1
(check `observability.ts` after the skip helpers). Errors/5xx may still be
logged.

Tests: `cloudflare-worker/test/` — source or unit test that those prefixes
are in both skip lists. `ae_branch_dimension_d161.test.ts` already imports
the middleware; do not break AE dimensions.

**Task 0.3 — Pause NotificationBell when hidden; poll only as WS fallback**

Files: `frontend/src/components/NotificationBell.jsx`

- If `document.hidden`, do not `setInterval` (listen to `visibilitychange`).
- If the pipeline overview WebSocket is `OPEN`, poll every **120s** (or not
  at all); if WS is down, poll every **30s**.
- Do not change the unread-count API contract.

Tests: `frontend/test/` source guard — assert `visibilitychange` or
`document.hidden` appears in `NotificationBell.jsx`, and that `30000` is not
the only cadence (120s fallback or WS-gated). Existing
`inbox_page_d144.test.mjs` reads this file; keep it passing.

**Task 0.4 — `requireAuth` uses the cached user**

Files: `cloudflare-worker/src/auth.ts`, `cloudflare-worker/src/middleware/rateLimit.ts`

- `requireAuth` / `getCurrentUser`: if `c.get('currentUser')` is a user
  object, return it.
- For rate-limit-exempt paths (`/api/auth/me`), still resolve the user once
  and `c.set('currentUser', user)` without incrementing buckets. Split
  “resolve user” from “apply limits” in `rateLimit.ts` or do the resolve in
  `observability.ts` when the cache is empty.

Tests: worker unit test — two `requireAuth` calls on one context with a
mocked DB hit the DB once.

**Done when:** a hidden tab generates no unread-count traffic; a visible tab
with WS up polls at most once per 2 minutes; global 429 cannot fire at 200
tabs × 2 req/min; polled GETs do not insert `activity_logs`.

### Phase 1 — Auth read path

**Task 1.1 — Narrow `getCurrentUser` SELECT**

Files: `cloudflare-worker/src/auth.ts`

Replace `SELECT * FROM users WHERE id = ?` with an explicit list of columns
the session actually reads (id, uid, email, name, role, is_active,
jwt_min_iat, password hash only on login routes — **not** on the session
hot path, investor/founder/partner public ids used by the SPA, tier fields
already on the row). Keep MI Pro and super-admin as separate keyed lookups.

Do **not** JOIN side tables into this SELECT.

If a route later needs a rare column, that route queries it. Grep callers
that read `user.<col>` from `requireAuth` before deleting a column from the
list.

Tests: worker test that the hot-path SQL string does not contain `SELECT *`.
Existing auth tests must still log in.

**Task 1.2 — Cold-start: stop rebuilding `users` on fetch**

Files: `cloudflare-worker/src/index.ts`, `services/exploringSchema.ts`,
`util/usersRoleRebuild.ts`

- Keep the isolate latch.
- On fetch, **only** `SELECT sql FROM sqlite_master WHERE name='users'` (or
  the existing cheap CHECK read). If the CHECK already admits
  investor/advisor/exploring, return. Never run `rebuildUsersRoleCheckFor*`
  inside `app.fetch`.
- Move the rebuild to `scheduled()` once per process (or an admin
  maintenance route behind `requireAdmin`). First 1,000 users do not need a
  table rebuild on `/api/auth/me`.

Tests: unit test that a stubbed `sqlite_master` already-valid CHECK does not
call rebuild. Do not delete `usersRoleRebuild.ts`.

**Done when:** warm `GET /api/auth/me` is one JWT verify + one narrow users
SELECT + two side-table lookups + optional session touch; cold fetch does
not COPY the `users` table.

### Phase 2 — Client fan-out

**Task 2.1 — Shared pipeline overview WebSocket**

Files: `frontend/src/hooks/useWebSocket.js`, `NotificationBell.jsx`,
`PipelinePage.jsx` (and any other `/api/pipeline/ws/overview` caller)

One connection per tab. Bell subscribes for `type === 'notification'`.
Pipeline page uses the same hook instance (React context is OK:
`RealtimeProvider` in the authenticated shell).

Do not put the JWT in the query string if the subprotocol already carries
`bearer.<jwt>` — leave the query token if FastAPI dev still needs it; do not
expand that to new callers.

**Task 2.2 — Visibility pause helper**

Add `frontend/src/hooks/useIntervalWhenVisible.js` (or similar):

- `useIntervalWhenVisible(fn, ms)` — runs `fn` immediately, then on the
  interval only while `document.visibilityState === 'visible'`.
- Use it in: `NotificationBell` (if 0.3 still uses setInterval),
  `CustomerChatWidget`, `MonitoringPage`, `InfrastructureTab`,
  `LiquidityPage`, `TicketsPage`, `useIncorporationStatus`,
  `AdminDueDiligenceCasePage` (and bump that interval from 2500 to **8000**
  while a scan is in flight).

Tests: `frontend/test/poll_when_visible.test.mjs` — every file that
`setInterval`s an `api.` call must reference `hidden`, `visibilityState`, or
the shared hook. Allowlist UI-only clocks (impersonation countdown in
`App.jsx`, export progress).

**Task 2.3 — Defer PersonalAdvisor history**

Files: `frontend/src/components/advisor/PersonalAdvisor.jsx`

Do not fetch `api.advisor.conversation(cid)` until the rail/panel is open.
`advisor.start()` + progress is enough for the collapsed spine.

**Done when:** one pipeline WS per tab; background tabs do not poll; advisor
history is lazy.

### Phase 3 — D1 query hygiene

Latest migration at audit time: `237_portfolio_support_entries.sql`. Next
file is **`238_d1_scale_1000_dau.sql`** (renumber if 238 already exists).

```sql
-- Additive, IF NOT EXISTS only. No BEGIN/COMMIT. No ALTER TABLE users.

CREATE INDEX IF NOT EXISTS idx_advisor_bookings_slot_status
  ON advisor_bookings(slot_id, status);

CREATE INDEX IF NOT EXISTS idx_users_spinout_cohort
  ON users(spinout_lab_active, spinout_lab_started_at)
  WHERE spinout_lab_active = 1;

CREATE INDEX IF NOT EXISTS idx_us_user_active
  ON user_sessions(user_id, revoked_at, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_user_created
  ON notifications_inbox(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_advisor_msg_conv_created
  ON advisor_messages(conversation_id, created_at ASC);
```

Skip creating `idx_activity_user_created` if `idx_al_user (user_id, created_at
DESC)` already exists in `schema_baseline.sql`.

Do **not** recreate `advisor_state` / `customer_chat_*` in this file unless a
`--remote` `sqlite_master` check shows they are missing. GOTCHAS already
tracks those.

**Task 3.2 — `clampLimit` on unbounded lists**

Files: `routes/events.ts`, `routes/projects.ts` (investor/admin list),
`routes/calendar.ts` (IC meetings), `routes/advisor.ts` (messages).

Use `clampLimit` / `parseOffset` from `util/pagination.ts` (default 50, max
200). Advisor messages: max 200, oldest or newest consistent with the UI
(if the UI prepends, keep newest 200).

**Task 3.3 — Batch N+1**

- `routes/advisors.ts`: one `SELECT slot_id, COUNT(*) FROM advisor_bookings
  WHERE slot_id IN (...) AND status IN (...) GROUP BY slot_id`.
- `routes/calendar.ts` / `services/calendar.ts`: join attendees in one query
  per list, not per meeting. Bound IC list with `clampLimit`.

**Task 3.4 — Activity OR actor**

`routes/activity.ts`: if a backfill already hashed `actor`, query `user_id`
only. If not, leave the OR but do not add work; Phase 0 already stops
feeding the table from polls.

**Done when:** `node scripts/migrate-d1.mjs --dry-run` (local) includes 238;
events/projects/calendar/advisor lists always have LIMIT; `takenForSlot` is
not in a per-slot loop.

### Phase 4 — Dashboard burst (only if Phase 0–3 still leave D1 hot)

**Task 4.1 — Optional `GET /api/dashboard/studio-home`**

One Worker route returning the slice `FounderStudioHome` currently fans out
(subsidiaries, bookings, intros, lab, lifecycle, deck, financials, raise)
gated on role. Frontend `Promise.all` becomes one `api.` call.

Do this **only** after measuring (or if dashboard origin miss is still >1s
p95). Do not invent a BFF for every workspace.

Cache like `/api/dashboard/` (company-scoped KV).

### Phase 5 — Cron / bindings (optional at 1,000 DAU)

- Stagger Vectorize re-embed off minute 7; enqueue per-type jobs on
  `JOB_QUEUE` (`index.ts` scheduled handler).
- When `USE_CF_QUEUE=true` and `queue_jobs` has no `queued` rows for 7 days,
  skip `processQueueBatch` in cron (keep the code, gate it).
- Provision `AI_SPEND` KV only if `TOKENS` key cardinality becomes an ops
  problem. Uncomment the block in `wrangler.toml`; do not block 1,000 DAU
  on it.

---

## Suggested PR split

| PR | Phase | Title |
| --- | --- | --- |
| 1 | 0.1–0.4 | Stop notification-poll 429s and D1 write amplification |
| 2 | 1 | Narrow auth SELECT; keep role rebuild off the fetch path |
| 3 | 2 | Visibility-paused polling; one pipeline WebSocket per tab |
| 4 | 3 | D1 indexes + clampLimit + advisor/calendar batching |
| 5 | 4–5 | Only if still needed |

Do not mix `docs/` rebuilds into these PRs.

---

## Verification

After each PR:

```bash
# from repo root
npm run test:drift
# worker tests for the files you touched
cd cloudflare-worker && npm test
cd ../frontend && node --test test/poll_when_visible.test.mjs  # once Task 2.2 exists
```

Manual / browser (Phase 0 and 2):

1. Log in, leave the tab **visible** — unread-count may fire once, then at
   most every 30s (WS down) or 120s (WS up).
2. Switch away (`document.hidden`) — **no** further unread-count or admin
   poller traffic (DevTools Network).
3. Open Pipeline — still one `pipeline/ws/overview` in DevTools WS list.
4. Rapid navigation around the studio home — no 429s.

Do not treat Cloudflare Analytics Engine or `system_metrics` as a 5xx
incident signal without subtracting skipped poll paths (GOTCHAS: apex 5xx
baseline is not ~0%).

---

## Round-trip cheat sheet (warm isolate, after Phase 0–1)

| Request | Today (audit) | After Phase 0–1 |
| --- | --- | --- |
| `GET /api/auth/me` | ~8–14 D1 (duplicate auth, `SELECT *`) | ~3–4 narrow lookups |
| `GET /api/notifications/unread-count` | auth + COUNT + 2 D1 writes | auth + COUNT, **0** metric/activity writes |
| `GET /api/dashboard` cache miss | ~25–35 D1 + 2 writes | same origin fan-out, **0** activity writes; KV still 60s |
| `GET /api/health` | 0 | 0 |

Cold isolate today: +15–45 blocking DDL/CHECK work, possible `users` rebuild.
After 1.2: one cheap `sqlite_master` read.

---

## Pointers

- Architecture truth: `CLAUDE.md`
- Request-path schema bootstrap, `users` column ceiling, pagination:
  `documentation/architecture/GOTCHAS.md`
- Deploy: `documentation/operations/DEPLOY.md`
- Bindings (D1, KV, Queues, DOs, Vectorize, R2, AE): `wrangler.toml`
