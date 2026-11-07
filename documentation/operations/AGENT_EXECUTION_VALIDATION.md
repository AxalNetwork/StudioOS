# Agent execution validation: preview isolation, safe fixtures and teardown

D4566 (#4566, Agent capacity A0; parent #4554, agent product #3742). This is
how agent execution is tested **outside production**: an isolated preview
environment, a fail-closed preflight that proves the isolation, synthetic-only
fixtures, and their teardown. It is the prerequisite for the hosted lifecycle,
fault and capacity work in #4594 and the D1 benchmark in #4567.

**Nothing here changes production.** The committed switches stay
`AGENT_ENGINE="off"` and `AGENT_AUTONOMY="manual"` in `[env.production.vars]`;
the static preflight fails the build if either changes. No step here creates a
resource, deploys, enters a secret or switches anything on in production.
Every hosted step is the owner's, run by hand, after the preflight passes.

## The two modes

| Mode | What runs | Who runs it | What it may claim |
| --- | --- | --- | --- |
| **(a) Local simulator** | The real migrated schema in node:sqlite, the existing runtime seam (`AgentRuntime`, `doRuntime`), a fake Workflow binding, a fake `AGENT_QUEUE` and a fake `agentRun` (`cloudflare-worker/test/_agent_engine_fixture.ts`). Synthetic fixtures from `scripts/lib/agentSyntheticFixtures.mjs`. | CI, on every PR (`agent_execution_validation_4566.test.ts`) | **Simulated success** only: the code's rules hold over fakes. Never a hosted Workflow, a queue delivery, a model call or a capacity figure. |
| **(b) Owner-approved preview** | A deployed `studioos-preview` Worker over its **own** D1, KV, queues, DLQs, Workflow, R2 and Durable Object namespaces, with inference replaced by the synthetic stub. | The owner, by hand, after the preflight passes | **Preview-platform success**: the platform ran the flow over isolated resources. Never a production observation. |

A **production observation** (counts, analytics, the deploy log) is a third,
separate class, read-only, and is #4559's and #4567's. The three are never
reported as one: a PR or a report names which class each result is.

No new agent engine, scheduler, queue, ledger or permission system is added.
Both modes go through `src/agents/runtime.ts`'s seam and the existing
`AgentScope` → `AGENT_QUEUE` → `AgentTaskWorkflow` flow.

## The isolation matrix

`node scripts/check-preview-isolation.mjs --static --json` prints it in full;
the rules are `scripts/lib/previewIsolation.mjs`. Today (2026-11-06):

| Resource | Production | Preview, as declared | Status |
| --- | --- | --- | --- |
| Worker (and every Durable Object namespace without a `script_name`) | `studioos` | `studioos-preview` | separate name; unverified until observed |
| D1 `DB` (and the usage ledger: `ai_usage_logs`, `ai_budget_reservations`, `ai_credit_ledger`) | `studioos-db` | `studioos-db-preview`, id `REPLACE_WITH_PREVIEW_D1_ID` | **placeholder**: not provisioned |
| KV `RATE_LIMITS` (the halt key and circuit breaker), `TOKENS`, `OAUTH_KV` | production ids | `REPLACE_WITH_…` | **placeholder**: not provisioned |
| Queue `AGENT_QUEUE` and its DLQ | `studioos-agent-queue`, `-dlq` | `studioos-agent-queue-preview`, `-preview-dlq` | separate names; unverified |
| Queue `JOB_QUEUE` and its DLQ | `studioos-job-queue`, `-dlq` | `studioos-job-queue-preview`, `-preview-dlq` | separate names; unverified |
| Workflow `AGENT_TASK` | `studioos-agent-task` | `studioos-agent-task-preview` | separate name; unverified |
| Durable Object `MEETING_BOT_CONTAINER` | script `studioos-meeting-bot` | script `studioos-meeting-bot-preview` | separate script; unverified |
| R2 `FILES`, `PUBLICATIONS`, `COMPANY_LOGOS` | production buckets | `…-preview` buckets | separate names; unverified |
| Analytics Engine `ANALYTICS` | `studioos_metrics` | `studioos_metrics_preview` | separate dataset |
| AI Gateway (advisor) | `advisor-ongoing` | **empty** (inert, calls go direct) | fixed in this PR: it was production's slug |
| Workers AI `AI`, Browser `BROWSER` | the account's | the account's | **account-wide**: safe only with the inference stub and no browser use |
| Secrets | — | names observed by the owner | only the internal ones (`INTERNAL_SECRETS`) may be present |

**Branch configs** (`scripts/lib/branchConfig.mjs`) are a separate system with
their own identity checks (`check-branch-config.mjs`). Two of their choices
matter here: a branch shares HQ's Analytics Engine dataset **by design**
(filtered by branch), and gets no `OAUTH_KV`. A branch Worker is not an
agent-validation target; use preview.

## The preflight

```
node scripts/check-preview-isolation.mjs --static            # CI, every PR (test:guards)
node scripts/check-preview-isolation.mjs --observed obs.json # before every hosted run
node scripts/check-preview-isolation.mjs --observed obs.json --json > preflight.json
```

- **unsafe** (exit 1): any identity is production's; declared and observed
  disagree; a binding kind the preflight does not know; a secret not on the
  internal list (it could send mail, push, a webhook or a provider call);
  live inference; the browser used; production's agent switches not off/manual.
- **unverified** (exit 2): nothing shared, but a placeholder, a field the
  observation does not give, or no `account_permissions` in it. A token that
  could not read something is unverified, never safe.
- **isolated** (exit 0): every critical identity declared, observed, equal to
  its declaration and unlike production's. Only this lets a hosted run start.

The static mode reads `wrangler.toml` only. It fails on `unsafe`, and reports
placeholders without failing (they are today's committed state).

### The observation file

The owner fills it from read-only commands, against the **preview** account
scope, and keeps values that are identifiers and secret NAMES only:

```
npx wrangler d1 info studioos-db-preview --json          # database_id, name
npx wrangler kv namespace list                            # the preview namespaces' ids
npx wrangler queues list                                  # queue names
npx wrangler workflows list                               # workflow names
npx wrangler r2 bucket list                               # bucket names
npx wrangler secret list --env preview                    # secret NAMES (never values)
```

```json
{
  "taken_at": "2026-11-06T12:00:00Z",
  "account_permissions": ["d1:read", "kv:read", "queues:read", "workflows:read", "r2:read", "secrets:list"],
  "worker": "studioos-preview",
  "d1": { "DB": { "database_id": "<preview id>", "database_name": "studioos-db-preview" } },
  "kv": { "RATE_LIMITS": "<id>", "TOKENS": "<id>", "OAUTH_KV": "<id>" },
  "queues": ["studioos-agent-queue-preview", "studioos-agent-queue-preview-dlq", "studioos-job-queue-preview", "studioos-job-queue-preview-dlq"],
  "workflows": ["studioos-agent-task-preview"],
  "r2": ["studioos-files-preview", "studioos-publications-preview", "studioos-company-logos-preview"],
  "secrets": ["JWT_SECRET"],
  "inference": "stub",
  "browser": "unused"
}
```

The preview ids then go into `[env.preview]` of `wrangler.toml` by a reviewed
PR, replacing the placeholders, so declared and observed can match.

## Synthetic fixtures

```
node scripts/agent-validation-fixtures.mjs seed     --run a0run01 --tenants 2 --agents 1 --tasks 2 --preflight preflight.json --out seed.sql
node scripts/agent-validation-fixtures.mjs residual --run a0run01 --preflight preflight.json --out residual.sql
node scripts/agent-validation-fixtures.mjs cleanup  --run a0run01 --preflight preflight.json --out cleanup.sql
npx wrangler d1 execute studioos-db-preview --env preview --remote --file seed.sql
```

- **Synthetic only.** Every row's uid carries `syn-<run>-`, and every person
  an address at `synthetic.invalid` (undeliverable by RFC 2606). Tenants get
  their own company and project; agents and tasks are scoped to them.
- **Ceilings.** At most 10 tenants, 3 agents a tenant (one per role: `ceo`,
  `cto`, `cpo`), 5 tasks an agent. Money is synthetic integer microusd: a
  $1.00 monthly cap per agent and a $1.00 top-up per person. Over a ceiling is
  refused, never trimmed.
- **Fail closed.** The writer refuses without a preflight JSON whose verdict
  is `isolated` and whose observation is under 24 hours old. `--local` writes
  for a local SQLite copy only, and says so in the file.
- **Cleanup** deletes children before parents, by the marks only, so it never
  touches a row it did not make, and a second run deletes nothing. It works
  after a partial seed or a failed run. `ai_credit_ledger` is append-only: a
  synthetic person whose run wrote ledger rows is switched off, not deleted,
  and `residual` counts them. **The real teardown of a preview run is deleting
  its throwaway database** (below).

## Owner-only actions

None of these is in any PR; each is the owner's, with their approval recorded
on #4566 or #4594:

1. **Infrastructure.** Create the preview D1, the three KV namespaces, the four
   queues, the Workflow and the three R2 buckets in the account, by name. No
   `-preview` name is an isolation proof; the observation is.
2. **Billing.** Accept Workers Paid usage for preview: Workflow steps, queue
   operations, D1 reads and writes, R2. Set the **cost ceiling** for a run
   before it starts, and stop at it.
3. **Secrets.** Put only `JWT_SECRET` (and any other internal secret on the
   list) on `studioos-preview`. No mail, payment, messaging, model, OAuth or
   provider secret.
4. **Inference stub.** Deploy preview with inference replaced by the
   synthetic stub, so no paid model is called. (Building the stub's switch is
   #4594's.)
5. **Switch-on, preview only.** `AGENT_ENGINE` above `off` in `[env.preview.vars]`
   for the run's length, by a reviewed PR, never in production.
6. **Teardown and rollback.** Delete the run's database
   (`npx wrangler d1 delete studioos-db-preview`) or run `cleanup.sql` and
   check `residual.sql` reads zero (bar ledger-kept people); purge the preview
   queues; set `AGENT_ENGINE="off"` in preview again.

## Evidence

- **Store aggregates only** in a PR's artifacts: counts, durations, statuses,
  verdicts, the preflight JSON (identifiers and secret names, no values). Never
  raw prompts, model output, tokens, secrets, SQL bind values or real company data.
- **Which build ran.** Record the preview Worker's version id
  (`npx wrangler deployments list --env preview`) and the git commit it was
  built from, beside `main`'s commit at the time. A result on a build that is
  not `main`'s is labelled so.
- **Name the class** of every result: simulated, preview platform, or
  production observation.

## Related

- `AGENT_ENGINE_GO_LIVE.md`: production go-live, which this does not change.
- `AGENT_RUNTIME_SWITCH.md`: the runtime seam both modes use.
- `cloudflare-worker/test/preview_isolation_4566.test.mjs` and
  `cloudflare-worker/test/agent_execution_validation_4566.test.ts`: the rules, tested.
