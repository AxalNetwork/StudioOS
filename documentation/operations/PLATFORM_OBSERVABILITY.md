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

## 5. What is not built yet

- **Alert lifecycle.** `levelFor` takes the previous level for hysteresis, but
  nothing stores a level yet, so there is no deduplicated open/clear incident,
  no routing and no mute window. Next slice: a daily cron snapshot row per
  metric (also the trend and projection view), and an alert that opens once on
  a rising level and clears on recovery.
- **Account analytics** (Workers, D1 query volume and latency, Workflows, R2):
  see owner item 1.
- **The screen.** No canvas under `design/` covers a capacity panel, so per
  `AGENTS.md` § Missing UI the issue carries `needs-design` and the page is not
  invented. The route is ready for it.
- **Signals owned elsewhere** (second audit comment on #4559): scheduler
  progress #4592, lifecycle repair #4593, halt acknowledgement #4572, runtime
  DDL #4568, authentication monitor #4571, schema parity and restore
  #4591/#4558, provider quotas #4556, hosted evidence #4594. Each becomes a
  dictionary row when its owner exposes a source.

## 6. Owner items

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
