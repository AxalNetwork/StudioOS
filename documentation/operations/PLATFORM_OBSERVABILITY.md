# Platform infrastructure observability — inventory and metric dictionary (D4559)

Issue #4559, parent #4554. Agent execution, spend, alerts and halt belong to
#3851 and are not repeated here: this file covers the services underneath. It
is built from `wrangler.toml` (`[env.production]`), `services/topology.ts`'s
`BINDINGS` (held to the toml by `topology_d209.test.ts`) and the monitoring
code that exists today. Nothing here was measured against production; every
"available" below means "a source exists in code or in a binding", not "a value
has been seen".

**Rule for every row: missing is not zero.** A metric whose source did not
answer is `unavailable`, with `value: null` and a reason, and its level is
`unknown`. An unknown keeps the overall level from reading `ok`.

## 1. What production binds

| Service | Bindings (`[env.production]`) | Resource |
| --- | --- | --- |
| Worker | `studioos` script, `[assets]` `ASSETS`, six cron lines, tail consumer `studioos-tail` | one script, two hosts |
| D1 | `DB` | `studioos-db` (one database for every table) |
| KV | `TOKENS`, `RATE_LIMITS`, `OAUTH_KV` | three namespaces |
| Queues | producers `JOB_QUEUE`, `AGENT_QUEUE`; consumers for both and their DLQs | `studioos-job-queue`, `studioos-agent-queue`, `…-dlq` (DLQs have no producer binding) |
| Durable Objects | `PIPELINE_ROOM`, `ONBOARDING_CHAT`, `MEETING_BOT_RUN`, `MEETING_BOT_CONTAINER` (script `studioos-meeting-bot`), `DECK_PRESENCE`, `DECK_GEN_ROOM`, `AI_GOVERNOR`, `DECK_REMOTE`, `AGENT_SCOPE`, `AGENT_SCOPE_SDK` | ten namespaces |
| Workflows | `AGENT_TASK` | `studioos-agent-task` |
| R2 | `FILES`, `PUBLICATIONS`, `BACKUPS`, `COMPANY_LOGOS` | four buckets |
| Vectorize | `VECTORIZE`, `DECK_QUOTES` | `axal-search`, `axal-deck-quotes` |
| Analytics Engine | `ANALYTICS` | dataset `studioos_metrics` (written per request by `middleware/observability.ts`) |
| Other | `AI` (Workers AI), `BROWSER`, `IMAGES`, `STREAM` | — |
| Containers | none yet; the general runner is #4557 | — |

## 2. What already reads it

| Surface | Route | Reads |
| --- | --- | --- |
| HQ · Platform | `GET /api/admin/platform/summary` | cron triggers (`cron_run_history`), dead-letter backlog over both D1 tables (`services/deadLetters`), incidents entered |
| HQ · Platform · Topology | `GET /api/admin/platform/topology` | which bindings are present (no health) |
| HQ · Platform · Storage | `GET /api/admin/platform/storage` | member R2 bytes, from D1 statements, totals only |
| Monitoring | `GET /api/monitoring/metrics`, `/errors`, `/throughput` | `system_metrics` in D1 (requests, latency, status) |
| Admin Analytics · Technical | `/api/monitoring/analytics/*` | Analytics Engine SQL when `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AE_API_TOKEN` are set, else D1 |
| AI usage | `GET /api/monitoring/ai-usage` | `ai_usage_logs` (the one AI usage ledger; not duplicated here) |
| **New (D4559)** | `GET /api/admin/platform/capacity` | D1 size, queue backlog and age, binding presence — §4 |

## 3. Metric dictionary

Columns: **source** (where the number comes from), **refresh** (when it is
read), **unit**, **aggregation**, **scope**, **threshold** (warning / critical),
**retention**, **missing** (what a failed read shows).

| Key | Source | Refresh | Unit | Aggregation | Scope | Threshold | Retention | Missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `d1.size_bytes` | D1 `meta.size_after` on `SELECT 1` | on each read of `/capacity` | bytes | point-in-time | deployment | 5 GB / 7.5 GB, hysteresis 0.25 GB (policy) | none (not stored yet) | `unavailable`, `unknown` |
| `d1.size_ratio` | `d1.size_bytes ÷ d1_limit_bytes` | same | ratio (bytes ÷ bytes) | point-in-time | deployment | — (the size carries the level) | none | `unavailable` |
| `queue.job.backlog_messages`, `queue.agent.backlog_messages` | `Queue.metrics().backlogCount` | on each read | messages | point-in-time | deployment | none set | none | `unavailable` |
| `queue.*.backlog_bytes` | `Queue.metrics().backlogBytes` | on each read | bytes | point-in-time | deployment | none set | none | `unavailable` |
| `queue.*.oldest_age_seconds` | `now − Queue.metrics().oldestMessageTimestamp` | on each read | seconds | point-in-time | deployment | 15 min / 60 min, hysteresis 60 s (**proposed**) | none | `unavailable`; empty queue is `none_waiting`; a timestamp ahead of the clock is `unavailable` |
| `agents.sweep.eligible` | `system_metrics` `agent_sweep_eligible`, trusted only from a batch labelled `scanned: true` (#4592) | each 5-minute sweep; read on each request, stale after 20 min | count (capped at 120 a scan) | the newest sweep | deployment | none | `system_metrics` cleanup (30 days) | `unavailable`; a sweep that did not scan is `not_running`; agents off is `not_running` |
| `agents.sweep.examined`, `.admitted`, `.refused`, `.resent` | `system_metrics` `agent_sweep_*` (#4592) | same | count | the newest sweep | deployment | none | same | `unavailable`; a sweep that admitted nothing records a real 0 |
| `agents.sweep.oldest_eligible_age_seconds` | `system_metrics` `agent_sweep_oldest_eligible_age_seconds` (age since the oldest eligible task was created) | same | seconds | the newest scan | deployment | 1 h / 6 h, hysteresis 5 min (**proposed**) | same | `unavailable`; nothing eligible is `none_waiting`; no scan is `not_running` |
| `agents.repair.pending`, `agents.repair.unresolved` | `system_metrics` `agent_repair_pending`, `agent_repair_ambiguous` (#4593) | each sweep, before its halt and engine checks | count (pending capped at 20 a sweep) | the newest sweep | deployment | none | same | `unavailable` |
| `agents.repair.oldest_age_seconds` | `system_metrics` `agent_repair_oldest_age_seconds`, counted only while a repair is still owed after the sweep | same | seconds | the newest sweep | deployment | 1 h / 6 h, hysteresis 5 min (**proposed**) | same | `unavailable`; nothing owed is `none_waiting` |
| `dr.restore.last_verified_age_seconds` | `drill-d1.json` in `BACKUPS`, validated by `readRestoreDrill` (#4558, D263) | monthly drill; read on each request | seconds | the latest drill (the marker keeps only the latest run) | deployment (HQ database) | 32 d (the Security page's rule) / 64 d (**proposed**), hysteresis 1 d | the marker is overwritten each run | `unavailable`; a failed or absent drill is `not_verified` and **critical**; a branch is `not_running` |
| `bindings[].present` | `env[NAME] != null` | on each read | boolean | — | deployment | — | — | presence is not health |
| `dlq.backlog` | D1 dead-letter tables (`services/deadLetters`) | HQ · Platform summary | rows | count | deployment | none set | table lifetime | block unreadable |
| `cron.trigger_state` | `cron_run_history` | HQ · Platform summary | state | latest per trigger | deployment | stale past schedule + grace | table lifetime | `never recorded` |
| `worker.requests`, `worker.latency_ms`, `worker.status` | `system_metrics` (D1) and AE `studioos_metrics` | per request | count, ms | sums, percentiles in the read | deployment | none set | D1 table cleanup; AE dataset retention | AE falls back to D1 |
| `workers.requests_errors_cpu` | GraphQL `workersInvocationsAdaptive` | — | — | — | account | — | Cloudflare's | **not read** (owner item 1) |
| `d1.reads_writes_latency`, `d1.query_errors` | GraphQL `d1AnalyticsAdaptiveGroups`, `d1QueriesAdaptiveGroups` | — | rows, ms | — | database | — | 31 days (Cloudflare docs) | **not read** (owner item 1) |
| `workflows.failures` | GraphQL `workflowsAdaptiveGroups` | — | count | — | account | — | Cloudflare's | **not read** (owner item 1) |
| `r2.stored_bytes`, `r2.operations` | GraphQL `r2StorageAdaptiveGroups`, `r2OperationsAdaptiveGroups` | — | bytes, count | — | bucket | — | Cloudflare's | **not read** (owner item 1) |
| Durable Objects, Vectorize, Containers | no binding-level read; dashboard only | — | — | — | — | — | — | **unavailable**; manual check in the dashboard |
| AI providers | `ai_usage_logs` (existing ledger) and AI Gateway analytics | existing | — | — | — | — | — | owned by #3851 / #4556 |

## 4. The slice in code (D4559)

`services/platformCapacity.ts`, served by `GET /api/admin/platform/capacity`
(Super Admin only, `private, no-store`). It reads only bindings the Worker
already holds: no account API, no token, no `fetch`. It names no member,
company or tenant.

Defaults and overrides (whole bytes, deploy variables, all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PLATFORM_D1_LIMIT_BYTES` | 10000000000 | the plan's per-database limit (Workers Paid, documented; the account plan is not readable from the Worker and is unconfirmed) |
| `PLATFORM_D1_WARN_BYTES` | 5000000000 | architecture review |
| `PLATFORM_D1_CRIT_BYTES` | 7500000000 | migration / partitioning assessment |

An override that is not a whole byte count, or breaks warning < critical ≤
limit, is ignored as a set and the response says so.

## 5. History and alerts (D4559 part 2)

`services/platformCapacityHistory.ts`, run by the scheduled handler on HQ only
(every 15 minutes at :11; the daily snapshot at 04:11 UTC).

**Snapshot.** `platform_capacity_snapshots` keeps one row per (scope, UTC day,
metric) for the capacity read's fixed deployment metrics only (`SNAPSHOT_KEY`):
`d1.size_bytes`, `d1.size_ratio`, and each queue's backlog, backlog size and
oldest age. An unreadable day is `value NULL, availability 'unavailable'`, never
0. No member, company, tenant, file name, SQL or secret is stored.

**Trend and projection.** `GET /api/admin/platform/capacity/history?days=N`
(1–365, default 90; Super Admin). Each series lists its daily points, nulls
included, and `last_measured_at`. `d1_projection` fits a straight line through
the measured days only and states:

| State | When |
| --- | --- |
| `insufficient` | fewer than 7 measured days, or under a week between first and last |
| `not_growing` | the line does not rise |
| `at_limit` | the latest size is at or over the limit |
| `beyond_horizon` | the limit is more than five years out; no month is named |
| `projected` | a month (`YYYY-MM`), the window, the points used, R², and a confidence of `low` or `medium` (never higher: `medium` needs 28+ points and R² ≥ 0.8) |

It names a month, not a day: a line through recent growth is a trend, not a
forecast.

**Alerts.** `platform_capacity_alerts` holds one row per episode, at most one
open per (scope, metric) (a partial unique index, so two racing sweeps open one).

| Reading | Effect |
| --- | --- |
| warning or critical (with hysteresis from the open episode's severity) | opens an episode, or changes the open one's severity in place |
| measured ok, or an empty queue | clears the open episode (recovery) |
| unreadable, with an episode open | holds it; an outage is not a recovery |
| unreadable, measured in the last 48 hours, nothing open | opens an `unavailable` episode (a freshness gap) |
| unreadable, never measured | nothing; it stays listed as unavailable |

Routing: active HQ Super Admins, in-app, category `operations`, link
`/admin/platform`. A member opts out with `notification_prefs.platform_capacity.in_app = false`.
Each notice is deduplicated by episode and stage, so an episode notifies once
per severity and once when it clears. `GET /api/admin/platform/capacity/alerts`
lists open episodes and those cleared in the last 30 days.
`POST /api/admin/platform/capacity/alerts/:id/mute` (`{ hours: 1..168, reason }`,
the Super Admin write bar, audited) stops an open episode's notices until
`muted_until`; it is still tracked and still clears.

## 5.1 Signals from other issues (D4559 part 3)

`services/platformCapacitySignals.ts` adds the signals that closed issues
record for themselves to the capacity read, the daily snapshot and the alert
episodes. It reads them where they are already written; it adds no table,
store, vendor or network call. Every signal carries `source`, `window`,
`sampling`, `unit`, `scope` (`deployment`) and `last_success_at`, the time its
source last produced the record used.

Two availabilities are new:

| Availability | Means | Level | Alerts |
| --- | --- | --- | --- |
| `not_running` | the subsystem that writes the signal is off here (team agents off; a sweep that did not scan; the restore drill on a branch) | `ok` | holds an open episode, opens none, never clears one: turning a feature off is not a recovery |
| `not_verified` | the source answered that there is nothing verified (the latest restore drill failed, or none ever ran) | `critical` | opens and holds; a passing drill clears it |

**What each issue shipped, and what is read:**

| Issue | Shipped | Read here |
| --- | --- | --- |
| #4592 | the sweep writes `agent_sweep_*` to `system_metrics` every 5 minutes | eligible, examined, admitted, refused, resent, oldest eligible age. A sweep that stops at the halt, the engine being off or paused, or manual autonomy records `eligible` 0 without looking, so this part adds a `scanned` label to the sweep's batch and trusts the eligible count and age only from `scanned: true`. Batches written before the label are `unavailable`. |
| #4593 | `sweepStrandedRuns` writes `agent_repair_*` | repairs found, repairs it could not settle, and the oldest age while one is still owed (a sweep that repaired or settled everything it found owes nothing, unless it hit its 20-run cap) |
| #4558 | the drill's marker `drill-d1.json`, read by HQ · Security | the age of the last passing drill; a failed or absent drill is `not_verified`, never an age |
| #4572 | the halt and revocation contract and its tests | **nothing.** The halt is a KV key with no acknowledgement or propagation time. A measured propagation bound is #4594's (open). |
| #4568 | a build-time ratchet on blind runtime `ALTER`s (`check-runtime-ddl.mjs`) and an audit | **nothing.** The Worker counts no runtime DDL attempt; `runSchemaBootstrap` records none. |
| #4571 | the probes' outcome line (`EDGE_CHALLENGED` … `VERIFIED_END_TO_END`) | **nothing.** The outcome is printed in the GitHub Actions run of `magic-link-probe.yml`; nothing reaches a Worker binding, and this read makes no outbound call. |
| #4556 | the AI Gateway slice, its retries counted per call | **nothing.** The slice has no caller and its switch is off, so no attempt is recorded; the shared upstream limits are published figures, not counters. |

These four are listed in the read's `not_read_here`, each with its reason.
A freshness rule: the sweep runs every 5 minutes, so a newest batch older than
20 minutes is `unavailable` and still says when it was written.

## 6. What is not built yet

- **Account analytics** (Workers, D1 query volume and latency, Workflows, R2):
  see owner item 1.
- **The screen.** The canvas posted on #4559 (2026-11-07) awaits the owner's
  approval and its export in `design/incoming/`, so per `AGENTS.md` § Missing UI
  the issue carries `needs-design` and the page is not built. The capacity,
  history and alert routes are ready for it.
- **Signals owned elsewhere.** Part 3 (§5.1) reads #4592, #4593 and #4558.
  #4572, #4568, #4571 and #4556 shipped no record the Worker can read; each
  becomes a row when a source exists. Schema parity (#4591) and hosted
  evidence (#4594) wait on those open issues.

## 7. Owner items

1. **Account analytics token.** The GraphQL datasets above need an account
   token with `Account Analytics: Read`. The Worker may already hold one as
   `CLOUDFLARE_AE_API_TOKEN` (used for Analytics Engine SQL); whether its scope
   covers the D1/Workers/R2/Workflows GraphQL datasets is unverified. Confirm
   the scope, or decide on a separate read-only secret. No code calls these
   datasets until then.
2. **Plan limit.** Confirm the account is on Workers Paid and the current D1
   per-database limit, or set `PLATFORM_D1_LIMIT_BYTES`.
3. **Thresholds.** Approve the queue oldest-age thresholds (15 / 60 min,
   proposed) and the D1 critical size (7.5 GB, within #4559's 7–8 GB).
4. **Canvas** for the capacity panel on HQ · Platform (`needs-design`).
5. **Part 3 thresholds.** Approve the proposed eligible-work and repair ages
   (1 h / 6 h each) and the restore drill's critical age (64 days; the 32-day
   warning is the Security page's existing rule). A failed or absent restore
   drill is critical from the first sweep after deploy: per D4558 no restore
   had passed as of 2026-11-06, so expect that episode to open.

## 7. Detected incidents (D4854)

HQ · Platform's **Health** zone shows one state (critical, degraded, unknown or
healthy) and the incidents the platform detects for itself. They are derived
on every read from the signal that raises them (`services/platformHealth.ts`):

- **Keyed and deduplicated.** One failure is one incident however often the
  page loads. It clears on the first read after the signal recovers.
- **Not stored.** No table is written.
- **Kept apart from published incidents.** Status-page incidents are entered
  by hand. They are counted apart and never raise or clear the state.
- **Never healthy with a gap.** A signal that could not be read is listed as
  unknown, and the state is not `healthy` while one is.

Thresholds are the constants at the top of `platformHealth.ts`. The response
reports them under `health.thresholds`. Each section below is a runbook that
an incident links to.

### 7.1 A scheduled job is failing or late

The incident names the trigger:

- **medium:** the latest run failed;
- **high:** `CRON_FAILURE_STREAK` runs in a row failed, or the expected run
  never came.

Steps:

1. Read the trigger's latest error on the Monitoring zone's cron table.
2. A missing run (stale) usually means the Worker deploy did not register its
   cron triggers. The deploy log's "Deployed studioos triggers" lines say which
   ones it did (`DEPLOY.md`).
3. A repeated failure is a code or data fault. Fix it and deploy; the incident
   clears at the first successful run.

### 7.2 The Stripe webhook is refusing or silent

The incident's severity depends on what the request log shows:

- **high:** the webhook refused `WEBHOOK_FAILURE_STREAK` deliveries in a row;
- **critical:** it refused `WEBHOOK_FAILURE_CRITICAL` in a row;
- **low:** nothing has been delivered for `WEBHOOK_SILENCE_HOURS` while Stripe
  is configured. A quiet store can be legitimate.

Steps:

1. Open **Payments › Stripe connection**. Check that the endpoint is
   registered, and that its signing secret is the one the Worker holds.
2. A 400 streak is almost always a signing-secret mismatch.
3. A 5xx streak is a fault in the handler. Look at the Worker's logs for
   `/api/billing/stripe/webhook`.
4. Stripe retries refused events for up to three days. The incident clears on
   the first 2xx.

### 7.3 Dead letters are waiting

Severity is **medium** from one dead letter and **high** from `DLQ_HIGH`.
Growth over time is not stored, so the figure is the backlog now.

Steps:

1. Read the backlog on the Monitoring zone, split into the legacy table and
   the queue mirror (`services/deadLetters.ts`).
2. Fix the cause before replaying.

### 7.4 Telemetry cannot be read

This incident is **high** when Analytics Engine cannot be read:

- `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_AE_API_TOKEN` is not set on HQ, or
- the SQL API did not answer.

It is **medium** when Analytics Engine answered but holds no request row for
`TELEMETRY_STALE_MINUTES`. Every metered request writes one
(`middleware/observability.ts`), so that means the writes are failing.

Missing telemetry is never drawn as zero traffic. The Health zone shows when
telemetry last worked; the time is kept in KV under `health:telemetry:last_ok`.

Steps:

1. Open **Topology › This deployment** and check whether the read is
   configured.
2. Check the token's scope (owner item 1 above).
3. Use Retry on the Health zone. The incident clears on the first good read.

### 7.5 The meeting bot is not starting

Read from each run's startup facts on `meeting_bots` (D5153), the latest
`BOT_START_READ` runs that reached a start outcome in the last seven days
(`services/meetingBotHealth.ts`, D5370). Two incidents, kept apart (D4857):

- **`meeting_bot:start_failed`, a failed check.** The host or runtime answered
  with a startup code. **medium** when the latest start failed; **high** when
  `BOT_START_FAILURE_STREAK` starts failed in a row, or the code is one of the
  readiness preflight's (`runtime_no_answer`, `runtime_process_exited`,
  `runtime_health_failed`).
- **`meeting_bot:unreported`, a report that never arrived.** The run failed
  with `runtime_unavailable` or `heartbeat_timeout`, no startup code was
  recorded and the runtime never called back. Same severities.

A start that works clears both. Without the table, or before migration
`202611090953`, the signal is unknown, never healthy. With `MEETING_BOT` off,
or on a branch, it is listed as not detected.

Steps:

1. Open **Platform › Meeting bots**. The recent failed runs list each run's
   stage, startup code and next step.
2. Follow that row's next step (`RUNTIME_ACTION` in
   `services/meetingBotStartup.ts`). A preflight code usually means the image
   or its version is wrong: redeploy the meeting-bot Worker.
3. Run the staged diagnostic against a meeting you host. A stage that reads
   Not recorded is a report that never arrived, not a failed check.

### 7.6 A branch is unhealthy or unchecked

Summary reads never ask a branch (D110). This reads the last check that
Deployments stored on `licence_deployments` (D452) for each branch in a live
state (`worker_live`, `hostname_active`, `linked`):

- **medium:** the branch answered its last check, and said it was not ok;
- **low:** no check in `BRANCH_CHECK_STALE_HOURS`, or never. Deployments
  stores only an answer, so a branch that is down looks like one nobody
  checked. A low note does not lower the state.

Steps:

1. Open the **Deployments** zone of Platform. Opening it asks every branch
   and stores each answer, which clears a stale note.
2. A branch that still does not answer: read its row's live state and HQ's
   own actions against it (D163), then its Worker's logs.

**Not detected here:**

- **The meeting bot's staged diagnostics.** A diagnostic is a check the owner
  starts, kept per run in R2 with no index. Its stages show on Meeting bots.
