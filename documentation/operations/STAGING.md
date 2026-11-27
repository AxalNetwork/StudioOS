# Staging: the isolated `studioos-preview` Worker

D7147 (#7147, tracker #7144). This file says what staging is, what it would
cost, and how the owner provisions it, rebuilds it and tears it down.

**Status on 2026-11-18: nothing is provisioned, and nothing may be.** Owner
decision F says the cost is estimated first and nothing is created until the
owner approves it on #7147. Every command below is the owner's, run by hand
after that approval. No workflow runs them. This runbook has never run.

## What staging is

- **One Worker: `studioos-preview`, the existing `[env.preview]` in
  `wrangler.toml`** (decision B1). No `[env.staging]` is added.
- **Its own resources.** It has its own D1, three KV namespaces, four queues,
  one Workflow, three R2 buckets, one Analytics Engine dataset and its own
  Durable Object namespaces. None of them is production's. The D4566
  preflight proves this from the identities, not from the names.
- **Synthetic data only** (decision C1). It holds the D4566 fixtures
  (`syn-<run>-` uids, `synthetic.invalid` addresses) and nothing copied from
  production.
- **Nothing leaves it.** Only internal secrets are set. It cannot send mail,
  take a payment, post to a messaging provider or call a paid model.
- **Its credentials live in the GitHub environment `staging`,** restricted to
  `main`. That environment holds no production credential.
- **Shared with the agent-validation runs** of #4566's follow-ups
  (`AGENT_EXECUTION_VALIDATION.md`). This runbook must not break them. Their
  `cleanup` and `residual` files still work, because every fixture row carries
  its run's mark.

### What it proves, and what it cannot

A green staging release (#7148) shows that the commit's migrations apply to a
D1 built from the committed files, and that Cloudflare accepted the Worker,
its bindings and its Durable Object migration tags. The probes (#7149) show
that the deployed build answers.

It cannot show:

- that a migration works on production's data, because staging holds
  synthetic rows;
- anything that needs production-only configuration, secrets, provider
  callbacks or real traffic;
- that Cloudflare's validator will accept the same upload again, because it
  varies between attempts (#5532).

## Resource inventory

This compares what `[env.preview]` declares with production's
`[env.production]`. It was read from `wrangler.toml` at `cf2810ad`.

| Kind | Binding | Production | `[env.preview]` declares | State |
| --- | --- | --- | --- | --- |
| Worker | — | `studioos` | `studioos-preview`, `workers_dev = true` | Created on first deploy. Its route table is empty (`routes = []`), so it keeps no custom domain. See step 0. |
| D1 | `DB` | `studioos-db` | `studioos-db-preview`, id `REPLACE_WITH_PREVIEW_D1_ID` | **Placeholder**, to create |
| KV | `TOKENS` | production id | `REPLACE_WITH_PREVIEW_KV_TOKENS_ID` | **Placeholder**, to create |
| KV | `RATE_LIMITS` | production id | `REPLACE_WITH_PREVIEW_KV_RATE_LIMITS_ID` | **Placeholder**, to create |
| KV | `OAUTH_KV` | production id | `REPLACE_WITH_PREVIEW_KV_OAUTH_ID` | **Placeholder**, to create |
| Queue | `JOB_QUEUE` | `studioos-job-queue` | `studioos-job-queue-preview` | Named, to create |
| DLQ | — | `studioos-job-queue-dlq` | `studioos-job-queue-preview-dlq` | Named, to create |
| Queue | `AGENT_QUEUE` | `studioos-agent-queue` | `studioos-agent-queue-preview` | Named, to create |
| DLQ | — | `studioos-agent-queue-dlq` | `studioos-agent-queue-preview-dlq` | Named, to create |
| Workflow | `AGENT_TASK` | `studioos-agent-task` | `studioos-agent-task-preview` | Created by the first deploy |
| R2 | `FILES` | `studioos-files` | `studioos-files-preview` | Named, to create |
| R2 | `PUBLICATIONS` | `studioos-publications` | `studioos-publications-preview` | Named, to create |
| R2 | `COMPANY_LOGOS` | `studioos-company-logos` | `studioos-company-logos-preview` | Named, to create |
| R2 | `BACKUPS` | `studioos-backups` | not declared | Not needed |
| Durable Objects | 11 classes in this Worker (`PIPELINE_ROOM` … `WORKSPACE_ADMISSION`), tags `v1`–`v9` | in `studioos` | the same classes in `studioos-preview` | Created by the first deploy |
| Durable Object | `MEETING_BOT_CONTAINER` | script `studioos-meeting-bot` | not declared | **Dropped by owner decision** (2026-11-18, D7147 part 2): staging binds no meeting-bot host while `MEETING_BOT = "off"`. |
| Analytics Engine | `ANALYTICS` | `studioos_metrics` | `studioos_metrics_preview` | Created by the first write |
| Workers AI | `AI` | account-wide | account-wide | Cannot be isolated. Stubbed (step 7). |
| Browser Run | `BROWSER` | account-wide | account-wide | Cannot be isolated. It must stay unused. |
| Vectorize | `VECTORIZE`, `DECK_QUOTES` | `axal-search`, `axal-deck-quotes` | not declared | None |
| Images, Stream | `IMAGES`, `STREAM` | account | not declared | None |
| Tail consumer | — | `studioos-tail` | not declared | None |
| Static assets | `ASSETS` | `./docs` | inherited from the top level (`./docs`) | The SPA is built before the deploy |
| Crons | — | six schedules | `* * * * *`, `0 */6 * * *`, `0 4 * * *` | Declared |

The isolation matrix has the same rows: `node scripts/check-preview-isolation.mjs --static --json`.

## Cost estimate (decision F)

Prices were read on **2026-11-18** from Cloudflare's published documentation:

- [W] <https://developers.cloudflare.com/workers/platform/pricing/>, last updated 2026-11-13. It covers Workers, KV, Queues, D1, Durable Objects, Workflows, R2 and Workers Logs.
- [D1] <https://developers.cloudflare.com/d1/platform/pricing/>, last updated 2026-10-30.
- [Q] <https://developers.cloudflare.com/queues/platform/pricing/>, last updated 2026-10-30.
- [KV] <https://developers.cloudflare.com/kv/platform/pricing/>, last updated 2026-10-30.
- [DO] <https://developers.cloudflare.com/durable-objects/platform/pricing/>, last updated 2026-11-13.
- [WF] <https://developers.cloudflare.com/workflows/reference/pricing/>, last updated 2026-11-04.
- [AE] <https://developers.cloudflare.com/analytics/analytics-engine/pricing/>, last updated 2026-04-23.
- [BR] <https://developers.cloudflare.com/browser-run/pricing/>, last updated 2026-04-21.
- [AI] <https://developers.cloudflare.com/workers-ai/platform/pricing/>, last updated 2026-11-12.

The pages were read through Cloudflare's documentation search. The session
could not fetch the site directly, and no Cloudflare account API was called.

### Assumptions

- **The account is on Workers Paid.** It already pays the $5 monthly
  minimum. Staging adds no subscription.
- **Every included allowance is per account and shared with production.**
  The cost of staging is the usage that falls beyond what production leaves
  unused. The **low** end assumes production leaves room, so staging costs
  nothing. The **high** end assumes production has already used every
  allowance, so each unit of staging is billed at the overage rate. This
  session could not read the account's usage, so the true figure is between
  the two.
- **Releases.** About one release for each `main` commit. From 2026-11-04 to
  2026-11-17, `cloudflare-worker-deploy.yml` started 19 to 139 runs a day,
  so this assumes **50 to 150 a day, which is 1,500 to 4,500 a month**.
- **Per release (#7148, #7149).** One migrate run and one dry run. Each reads
  the 903-row ledger, about 2,000 rows. One schema-parity read of
  `sqlite_master`, about 4,000 rows. About 60 Worker requests from the probes:
  health, the sign-in round trip, one R2 write and read, one KV write and
  read, and the shell routes. Static assets are free [W].
- **Crons.** About 43,350 invocations a month (`* * * * *`, `0 */6 * * *`,
  `0 4 * * *`). Each minute tick takes the KV lease (one read and one write)
  and records its run in D1. The estimate allows about 200 rows read, 5 rows
  written and 100 ms of CPU per tick. Market-intel connectors stay off,
  because no `MI_FLAG_*` is set in `[env.preview.vars]`.
- **Storage.** The schema built from 903 migrations plus the fixtures (2
  tenants, at most 10) is under 50 MB of D1. R2 and KV hold well under
  100 MB.
- **Agent engine off** (`AGENT_ENGINE = "off"`), so there are no Workflow
  instances or steps. Agent-validation runs are separate, owner-approved and
  capped (`AGENT_EXECUTION_VALIDATION.md`).
- **No model and no browser.** Inference is the D4594 stub and Browser Run is
  unused, as the preflight requires.

The per-tick and per-request figures are estimates, not measurements. The
first 20 shadow releases of #7148 measure them.

### Table

| Resource | Unit price (Workers Paid, beyond the account's included usage) | Assumed staging usage a month | Low | High |
| --- | --- | --- | --- | --- |
| Worker requests | $0.30 per million; 10 M included [W] | about 0.32 M (probes 0.27 M, crons 0.04 M, queue consumers) | $0 | $0.10 |
| Worker CPU | $0.02 per million CPU-ms; 30 M included [W] | about 10 M CPU-ms | $0 | $0.20 |
| D1 rows read | $0.001 per million; 25 bn included [D1] | about 40 M | $0 | $0.04 |
| D1 rows written | $1.00 per million; 50 M included [D1] | about 0.31 M (crons 0.22 M, probes 0.09 M) | $0 | $0.31 |
| D1 storage | $0.75 per GB-month; 5 GB included [D1] | ≤ 0.05 GB | $0 | $0.04 |
| D1 database | $0.10 per database a month beyond 100,000 [D1] | 1 | $0 | $0 |
| KV reads | $0.50 per million; 10 M included [KV] | about 0.6 M | $0 | $0.30 |
| KV writes | $5.00 per million; 1 M included [KV] | about 0.36 M (cron lease, rate limits, probe) | $0 | $1.80 |
| KV storage, namespaces | $0.50 per GB-month; $0.10 per namespace beyond 1,000 [KV] | < 0.01 GB; 3 namespaces | $0 | $0.01 |
| Queues | $0.40 per million operations, 3 per message; 1 M included; $0.10 per queue beyond 10,000 [Q] | about 10,000 messages, 30,000 operations; 4 queues | $0 | $0.01 |
| R2 | $0.015 per GB-month; Class A $4.50 per million; Class B $0.36 per million; 10 GB, 1 M A and 10 M B free [W] | < 0.1 GB; about 4,500 A and 4,500 B | $0 | $0.03 |
| Durable Objects requests | $0.15 per million; 1 M included [DO] | ≤ 50,000 | $0 | $0.15 |
| Durable Objects duration | $12.50 per million GB-s; 400,000 included; **billed in whole millions** [DO] | ≤ 20,000 GB-s | $0 | $0.25 (**$12.50** if it crosses a rounding step) |
| Durable Objects SQLite storage | $0.20 per GB-month; 5 GB included [DO] | < 0.01 GB | $0 | $0.01 |
| Workflow | steps $0.80 per 100,000 beyond 500,000; storage $0.20 per GB-month beyond 1 [WF] | 0 (engine off) | $0 | $0 |
| Analytics Engine | $0.25 per million data points; 10 M included; **not billed today** [AE] | about 0.35 M points | $0 | $0.09 |
| Workers Logs | $0.60 per million events; 20 M included; **moves to Observability pricing on 2026-12-01** [W] | about 0.5 M events | $0 | $0.30 |
| Workers AI | $0.011 per 1,000 Neurons beyond 10,000 a day [AI] | 0 (stub) | $0 | $0 |
| Browser Run | $0.09 per browser-hour beyond 10; $2.00 per concurrent browser beyond 10 [BR] | 0 (unused) | $0 | $0 |
| **Total a month** | | | **$0.00** | **about $3.70, or about $16 if the Durable Object duration crosses a rounding step** |

**One-off provisioning** costs a few thousand D1 row writes for the bootstrap
(the figure `schema-rehearsal.yml` records) and a few hundred for the
fixtures. That is under $0.05 at the high end.

**There is no fixed monthly fee.** Each per-resource charge (D1 databases, KV
namespaces, queues) starts only above an account count that staging does not
approach. The owner can confirm the account's counts in the dashboard. Three
charges can jump in steps rather than grow smoothly:

1. **Durable Object duration** is rounded up to a whole million GB-s. If
   staging pushes the account total across a boundary, the step is $12.50.
2. **Browser concurrency** costs $2.00 per browser above ten, averaged over the
   month. It is $0 while staging leaves the browser unused, and the preflight
   requires that.
3. **Workers AI** is the risk to cost, not a price step. `[env.preview.vars]`
   holds `WORKERS_AI_ADVISOR_BUDGET_USD_DAY = "100"`. Without the stub, an
   advisor call from staging would be billed to the account. Step 7 deploys
   with the stub on, and the preflight refuses `inference: "live"`.

**Recommendation for F:** approve a ceiling of **$20 a month** for staging.
That covers the high case plus one Durable Object rounding step. Set a
Cloudflare spend alert at that figure. #7148's shadow report confirms the
real figure after 20 releases.

## Isolation rules

They are fixed by D4566 and D7147.

1. **Identities, not names.** The run counts only when
   `node scripts/check-preview-isolation.mjs --observed obs.json` exits 0
   (`isolated`). `--static` runs on every PR. A placeholder is `unverified`,
   and `unverified` blocks a hosted run.
2. **No route but workers.dev.** Staging has no custom domain and no zone
   route (step 0).
3. **Secrets: the internal allowlist only.** The allowlist is
   `INTERNAL_SECRETS` in `scripts/lib/previewIsolation.mjs`. The preflight
   fails on any other secret name, including one added later.

   | May be set (fresh values, never production's) | Purpose |
   | --- | --- |
   | `JWT_SECRET`, `SCORING_HMAC_SECRET` | **Required.** `/api/*` answers 503 `config_error` without them. |
   | `AXAL_ENCRYPTION_SECRET`, `MAIL_LINK_SECRET`, `NEWSLETTER_TOKEN_KEY`, `RPC_SECRET` | Optional. Signing and encryption inside the Worker. |

   **These must stay unset,** along with every other name the Worker reads
   (`cloudflare-worker/src/types.ts`) that is not in the allowlist:

   - **Mail:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAIL_GMAIL_*`, `MAIL_MICROSOFT_*`.
   - **Payments and KYC:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ATLAS_API_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `PERSONA_API_KEY`, `SUMSUB_*`, `DOCUSIGN_*`.
   - **Messaging and push:** `SLACK_BOT_TOKEN`, `SLACK_CLIENT_*`, `AXAL_TEAM_SLACK_WEBHOOK_URL`, `TELEGRAM_*`, `WHATSAPP_*` tokens and secrets, `VAPID_PRIVATE_KEY`, `X_*`.
   - **Models:** `ANTHROPIC_API_KEY`, `AI_PROVIDER_ANTHROPIC_KEY`, `OPENAI_API_KEY`, `CF_AI_CATALOGUE_TOKEN`, `AGENT_COMPUTE_SECRET`.
   - **OAuth and integrations:** `GOOGLE_*`, `MICROSOFT_*`, `LINKEDIN_*`, `GITHUB_*`, `HUBSPOT_*`, `SALESFORCE_*`, `SF_*`, `CALENDLY_*`, `CARTA_*`, `TYPEFORM_*`, `VERCEL_*`, `TIKTOK_*`, `ZOOM_*`, `MEETING_BOT_*`, `MEET_BOT_GOOGLE_*`.
   - **Cloudflare and data APIs:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AE_API_TOKEN`, `STREAM_API_TOKEN`, `STREAM_WEBHOOK_SECRET`, `COMPANIES_HOUSE_API_KEY`, `CRUNCHBASE_API_KEY`, `OPENCORPORATES_API_KEY`, `GCIP_*`, `GCP_*`, `TURNSTILE_SECRET_KEY`.
   - **Cross-deployment:** `HQ_RPC_SECRET`, `HQ_RPC_SECRET_HASH`, `WORKGRAPH_INGEST_TOKEN`, `KEK_PII`, `KEK_R2`, `PII_KEK_HEX`, `R2_KEK_HEX`.

4. **The off flags stay off.** Every switch in `[env.preview.vars]` stays as
   committed: `AGENT_ENGINE = "off"`, `MEETING_BOT = "off"`,
   `MCP_SERVER_ENABLED = "false"`, `API_KEYS_ENABLED = "false"`,
   `ROUND_CALLS_ENABLED = "false"`, the WhatsApp and Telegram switches, and an
   empty AI Gateway slug.
   **No meeting-bot binding.** By owner decision (2026-11-18, D7147 part 2,
   amending D886 for staging), `[env.preview]` declares no
   `MEETING_BOT_CONTAINER`, so staging never reaches a bot host. The guard
   (`botBindingProblem` in `scripts/lib/meetingBotBinding.mjs`, run by
   `meetingBotDeploy.test.mjs` and the Teams matrix row
   `site_binds_its_own_bot_host`) allows a preview with no binding only while
   `MEETING_BOT = "off"`. A preview binding, if one comes back, may name only
   `studioos-meeting-bot-preview`, never production's host or a local class.
5. **Inference is the stub.** Every deploy passes
   `--var AGENT_INFERENCE_STUB:deterministic`. The stub is honoured only when
   `ENVIRONMENT = "preview"` (D4594). `wrangler.toml` must never name that
   variable: `inference_stub_4594.test.ts` holds that. #7148's release job must
   pass the flag on every deploy, or the stub is lost.
6. **The browser stays unused,** and the observation says so.
7. **Synthetic data only.** It is seeded by `scripts/agent-validation-fixtures.mjs`,
   which refuses without an `isolated` preflight under 24 hours old. Nothing
   is ever imported from production, including an export, a backup or a Time
   Travel copy.

## Credentials

| Credential | Holds | Lives in | Lifetime |
| --- | --- | --- | --- |
| **Provisioning token** | An account-owned Cloudflare API token with Workers Scripts Admin, D1 Edit, Workers KV Storage Edit, Queues Edit and Workers R2 Storage Edit. **No zone permission.** Creating a Worker needs product-level Workers Admin. | The owner's shell only | One run. Revoke it at step 11. |
| **Staging token** | An account-owned token with Workers Editor scoped to **Specified Workers: `studioos-preview`** and D1 Edit. D1 Edit **scoped to `studioos-db-preview` only** (owner decision, D7147-p3). **No zone permission** and no Workers Admin. | The GitHub environment `staging`, secret `CLOUDFLARE_API_TOKEN` | Until rotated |
| `CLOUDFLARE_ACCOUNT_ID` | The account id | The `staging` environment secret | — |

The staging token cannot create a Worker. It cannot deploy or change
`studioos`, because it is scoped to one Worker. It cannot attach a custom
domain, because it has no zone permission. **It must not reach `studioos-db`:**
the owner requires the D1 grant scoped to the one staging database (D7147-p3).
If the token dashboard offers D1 Edit only for the whole account, stop at step
11 and report it on #7147; do not install a product-wide token. The `staging`
environment is restricted to `main` and holds no production secret.

## Provisioning runbook

**Run it only after the owner approves F on #7147.** The steps are in order,
and each one must pass before the next. Each step is idempotent. A step looks
up the resource by name before it creates it, so a re-run after a failure
resumes instead of duplicating. That is `branch-provision.yml`'s style.

```bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)          # a clean checkout of main
W="$ROOT/cloudflare-worker/node_modules/.bin/wrangler"   # the locked wrangler (npm ci --prefix cloudflare-worker)
: "${CLOUDFLARE_API_TOKEN:?the provisioning token}" "${CLOUDFLARE_ACCOUNT_ID:?}"
SCRATCH=$(mktemp -d)   # create commands run here, away from wrangler.toml, so no config is edited
```

### Step 0: gates (stop if any fails)

1. **F is approved** on #7147, and the approved ceiling is recorded there.
2. **The route inheritance is closed.** Without a `routes` key, an environment
   inherits the top-level routes, which are the `axal.vc` and `app.axal.vc`
   custom domains. On `cf2810ad`, Wrangler warned: *"Deploying this environment
   will reassign these custom domains away from the top-level Worker."* The
   #7147 PR adds `routes = []` to `[env.preview]`, and
   `cloudflare-worker/test/preview_isolation_4566.test.mjs` resolves the config
   as `wrangler deploy` does and fails if preview carries any route. Confirm
   that this still prints `[]`:

   ```bash
   (cd "$ROOT/cloudflare-worker" && node -e "const w=require('wrangler');process.stdout.write(JSON.stringify(w.unstable_readConfig({config:'../wrangler.toml',env:'preview'}).routes))" 2>/dev/null); echo
   ```

   Until it prints `[]`, **never run `npm run deploy:preview`**. The
   provisioning token has no zone permission, so a mistaken deploy fails
   instead of moving the hosts. Do not rely on that alone.
3. **No meeting-bot binding.** `[env.preview]` declares no
   `MEETING_BOT_CONTAINER` and keeps `MEETING_BOT = "off"` (open question 2,
   settled).
4. `node scripts/check-preview-isolation.mjs --static` passes.

### Step 1: D1

```bash
cd "$SCRATCH"
d1_id() { "$W" d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).filter(x=>x.name===process.argv[1]);if(m.length>1)process.exit(3);if(m[0])console.log(m[0].uuid)})' "$1"; }
[ -n "$(d1_id studioos-db-preview)" ] || "$W" d1 create studioos-db-preview
D1_ID=$(d1_id studioos-db-preview); [ -n "$D1_ID" ]; echo "D1 studioos-db-preview $D1_ID"
```

### Step 2: three KV namespaces

```bash
kv_id() { "$W" kv namespace list | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).filter(x=>x.title===process.argv[1]);if(m.length>1)process.exit(3);if(m[0])console.log(m[0].id)})' "$1"; }
for t in studioos-preview-tokens studioos-preview-rate-limits studioos-preview-oauth; do
  [ -n "$(kv_id "$t")" ] || "$W" kv namespace create "$t"
  echo "KV $t $(kv_id "$t")"
done
```

### Step 3: four queues

```bash
for q in studioos-job-queue-preview studioos-job-queue-preview-dlq studioos-agent-queue-preview studioos-agent-queue-preview-dlq; do
  "$W" queues info "$q" >/dev/null 2>&1 || "$W" queues create "$q"
done
```

### Step 4: three R2 buckets

```bash
for b in studioos-files-preview studioos-publications-preview studioos-company-logos-preview; do
  "$W" r2 bucket info "$b" >/dev/null 2>&1 || "$W" r2 bucket create "$b"
done
```

The Workflow, the Durable Object namespaces and the Analytics Engine dataset
are not created by hand. The first deploy creates the first two, and the first
write creates the dataset.

### Step 5: write the ids (a reviewed PR)

Write the four ids with the writer, not by hand (D7147-p3). It replaces the
four `REPLACE_WITH_PREVIEW_…` values in `[env.preview]` and nothing else,
checks each id's format, refuses an id production uses or a repeated KV id,
and refuses any result the static isolation check rejects. With
`--workers-subdomain` it also corrects `APP_URL` and `EXTRA_DEV_ORIGINS` to the
real `studioos-preview.<subdomain>.workers.dev` host (open question 4); the
subdomain is on the dashboard's Workers overview, or `wrangler whoami`.

```bash
cd "$ROOT" && git switch -c agent/<you>/7147-staging-ids origin/main
node scripts/staging-write-ids.mjs --d1 "$D1_ID" \
  --kv-tokens <studioos-preview-tokens id> --kv-rate-limits <studioos-preview-rate-limits id> \
  --kv-oauth <studioos-preview-oauth id> --workers-subdomain <subdomain>
node scripts/check-preview-isolation.mjs --static   # prints "ids provisioned"
git diff --stat                                      # wrangler.toml only
```

Namespace and database ids are public configuration (D681). The PR needs no
other file: `--static` already refuses a half-written set, so once the ids are
real a placeholder cannot come back without all four (a tear-down), and
`cloudflare-worker/test/preview_isolation_4566.test.mjs` accepts either
consistent state.

Steps 6 to 10 run from `main` after it merges.

### Step 6: build the database

This is the path `schema-rehearsal.yml` proves.

```bash
cd "$ROOT"
node scripts/migrate-d1.mjs --preview --bootstrap   # empty database only; on a re-run it refuses a non-empty one: go on
node scripts/migrate-d1.mjs --preview
node scripts/migrate-d1.mjs --preview --dry-run     # must report nothing pending
```

### Step 7: deploy with the stub

```bash
cd "$ROOT" && npm ci && npm run build                # the SPA (assets are inherited: ./docs)
cd "$ROOT/cloudflare-worker"
"$W" deploy --config ../wrangler.toml --env preview \
  --var "AGENT_INFERENCE_STUB:deterministic" --var "WORKER_DEPLOY_VERSION:$(git rev-parse HEAD)"
```

Check that the "Deployed studioos-preview triggers" lines name only a
`workers.dev` host and the three crons. If any line names `axal.vc`, run
`npm run deploy` on `main` at once. That restores production's hosts. Then
report it on #7147.

### Step 8: internal secrets

Each value is fresh and is never shown.

```bash
put() { openssl rand -base64 48 | tr -d '\n' | "$W" secret put "$1" --config ../wrangler.toml --env preview >/dev/null; }
for s in JWT_SECRET SCORING_HMAC_SECRET; do
  "$W" secret list --config ../wrangler.toml --env preview | grep -q "\"$s\"" || put "$s"
done
"$W" secret list --config ../wrangler.toml --env preview   # names only: each must be in INTERNAL_SECRETS
curl -fsS "https://studioos-preview.<account workers.dev subdomain>/api/health"   # 200
```

### Step 9: the observed isolation preflight

Fill `obs.json` from the read-only commands in
`AGENT_EXECUTION_VALIDATION.md` § "The observation file":

- `d1 info`;
- `kv namespace list`;
- `queues list`;
- `workflows list`;
- `r2 bucket list`;
- `secret list --env preview`.

Also record `"inference": "stub"`, `"browser": "unused"`, `taken_at` and the
token's `account_permissions`. Then:

```bash
node scripts/check-preview-isolation.mjs --observed obs.json --json > preflight.json; echo "exit $?"   # 0 only on isolated
```

**Attach `preflight.json` to #7147.** It holds identifiers and secret names
only. A verdict of `unverified` (exit 2) or `unsafe` (exit 1) stops the
runbook.

### Step 10: seed the synthetic fixtures

```bash
RUN=stg$(date -u +%Y%m%d)   # 6-20 chars, [a-z0-9]
node scripts/agent-validation-fixtures.mjs seed --run "$RUN" --tenants 2 --agents 1 --tasks 2 --preflight preflight.json --out seed.sql
"$W" d1 execute studioos-db-preview --config ../wrangler.toml --env preview --remote --file seed.sql
node scripts/agent-validation-fixtures.mjs residual --run "$RUN" --preflight preflight.json --out residual.sql
"$W" d1 execute studioos-db-preview --config ../wrangler.toml --env preview --remote --file residual.sql   # counts > 0
```

A seed run twice with the same `RUN` writes nothing new (`INSERT OR IGNORE`).
Record `RUN` on #7147.

### Step 11: hand over to `staging`

1. Create the **staging token** (see "Credentials").
2. In the GitHub environment `staging`, set the deployment-branch rule to
   `main` only. Add the secrets `CLOUDFLARE_API_TOKEN` (the staging token) and
   `CLOUDFLARE_ACCOUNT_ID`.
3. **Revoke the provisioning token.**
4. Post on #7147:
   - that the Worker answers on its `workers.dev` host;
   - the preflight JSON;
   - the fixture `RUN`;
   - the date.

### Resuming

| Failed at | Re-run from | Why it is safe |
| --- | --- | --- |
| 1 to 4 | the same step | Each looks the resource up by name first. |
| 5 | the PR | It changes ids only. |
| 6 | the plain run | Bootstrap refuses a non-empty database. The ledger skips applied files. |
| 7 | the same step | A deploy replaces the version. Durable Object migrations apply once by tag. |
| 8 | the same step | It skips names already present. |
| 9, 10 | the same step | Read-only, and the seed is `INSERT OR IGNORE`. |

## Tear down, and rebuild from nothing

**Tear down** with the provisioning token:

```bash
"$W" delete --config ../wrangler.toml --env preview      # the Worker, its Durable Objects and the Workflow
"$W" d1 delete studioos-db-preview
for t in studioos-preview-tokens studioos-preview-rate-limits studioos-preview-oauth; do "$W" kv namespace delete --namespace-id "$(kv_id "$t")"; done
for q in studioos-job-queue-preview studioos-job-queue-preview-dlq studioos-agent-queue-preview studioos-agent-queue-preview-dlq; do "$W" queues delete "$q"; done
for b in studioos-files-preview studioos-publications-preview studioos-company-logos-preview; do "$W" r2 bucket delete "$b"; done   # empty them first
```

Then open a PR that puts the four placeholders back. Revoke the staging
token. The Analytics Engine dataset expires on its own retention.

**Rebuild from nothing:** tear down, then run steps 0 to 11. The new ids
arrive in a new step-5 PR.

## Open questions for the owner

1. **F.** Approve the estimate, at a ceiling of $20 a month, or decline it.
2. **The meeting-bot binding. Settled, 2026-11-18: dropped.** The owner chose
   (b) on #7147 and amended D886 for staging (D7147 part 2). `[env.preview]` no
   longer binds `MEETING_BOT_CONTAINER` to `studioos-meeting-bot-preview`. That
   Worker is deployed only by `meeting-bot-deploy.yml`, behind
   `MEETING_BOT_DEPLOY_ENABLED`, its recent runs on `main` failed, and it is
   not known to exist; a binding to a script that does not exist was expected
   to be refused at upload. `MEETING_BOT` is `"off"` in preview, and the guards
   refuse a preview with no binding if it is switched on. The meeting-bot
   preview host stays out of #7147's scope.
3. **The D1 scope of the staging token. Settled, 2026-11-18: require
   single-database scope** (D7147-p3). Product-level D1 Edit is not accepted;
   if it is the only grant offered, step 11 stops and reports.
4. **The preview host vars.** `APP_URL` and `EXTRA_DEV_ORIGINS` in
   `[env.preview.vars]` name `https://studioos-preview.workers.dev`. A
   workers.dev host is `studioos-preview.<account subdomain>.workers.dev`, so
   the vars name a host that does not exist. The step-5 writer corrects them
   when given `--workers-subdomain`; leave the flag off to keep them as they
   are. They are vars, not ids.

## Related

- `AGENT_EXECUTION_VALIDATION.md`: the isolation matrix, the observation file
  and the fixtures this reuses.
- `SCHEMA_DRIFT.md` §5 and `schema-rehearsal.yml`: the provisioning path
  (`migrate-d1.mjs --bootstrap`) proven on a throwaway D1.
- `.github/workflows/branch-provision.yml`: the idempotent create style.
- `DEPLOY.md`: production's release. Staging never takes its lock.
- #7148 (the staging release in shadow) and #7149 (the qualification probes)
  build on this.
