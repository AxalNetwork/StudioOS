# MCP engine, API keys and AI token accounting: the implementation plan

The maintained plan for the MCP and API platform: StudioOS as an MCP server,
StudioOS as an MCP client, native connector adapters, member API keys, and
one AI token ledger for all of it. **Update this file at the end of every
session that changes the platform.** The tracking issue is
[#2463](https://github.com/AxalNetwork/StudioOS/issues/2463), and every task
it names is listed in §7.

Verified on `origin/main` at `56c2498983` (2026-10-21) by S21.

## 1. What exists today (verified, so nobody re-discovers it)

### Axal as an MCP server: built (D665, D666, D669, D784)

- **Endpoint.** `https://axal.vc/mcp` is answered before the Hono `/api` app.
  `cloudflare-worker/src/index.ts` calls `routeMcp` when `isMcpPath` matches.
  `/api/mcp` answers 308 to `/mcp`.
- **Protocol.** `cloudflare-worker/src/mcp/server.ts` serves it with
  `@modelcontextprotocol/sdk`'s web-standard Streamable HTTP transport, in
  stateless mode (one server per request, `enableJsonResponse`). Tool input is
  validated by `CfWorkerJsonSchemaValidator`, because ajv's `new Function` is
  refused on Workers.
  - Cloudflare `agents`' `createMcpHandler` was rejected on purpose: it pins
    an SDK inside GHSA-6qxp-vccf-f47h. See the header of `server.ts`.
- **Auth.** OAuth 2.1 through `@cloudflare/workers-oauth-provider`
  (`mcp/oauth.ts`): dynamic client registration, PKCE S256 only, and the
  RFC 8414 and RFC 9728 metadata.
  - Consent is parked in `OAUTH_KV` and answered by the SPA at
    `/connect/assistant` (`routes/mcp_consent.ts`).
  - Scopes are `validate:read` and `validate:write` only.
- **Per-call checks** (`callTool`):
  - the grant's user is re-read, so an ended account or a "sign out
    everywhere" (`jwt_min_iat`) refuses the call;
  - the company is re-checked (`grantCompany`, using `canReadBoard` or
    `canWrite`);
  - the scope is checked;
  - 60 calls a minute per grant (KV, fail-closed);
  - one `activity_logs` line per call with the tool, company, client and
    outcome, never the arguments or the result.
- **Tools.** Six, registered through `registerMcpTools`:
  - reads in `mcp/tools/context.ts`: `list_companies`,
    `get_validate_context`, `get_interview_guide`;
  - interview tools in `mcp/tools/interviews.ts`.
- **Flag.** `MCP_SERVER_ENABLED` plus the `OAUTH_KV` binding; with either
  missing, every MCP path is 404.
- **Gaps for this plan:**
  - only OAuth bearer tokens are accepted, with no member API key;
  - only Validate scopes exist;
  - there is no execution id and no per-call usage row;
  - no tool is metered or charged;
  - no connector-backed tools exist.

### Axal as an MCP client: one bespoke client (D840), shared one planned (#2404)

- `cloudflare-worker/src/services/mercury/mcp.ts` and `services/mercury/oauth.ts`
  connect to Mercury's MCP server. They do discovery, client registration,
  PKCE, refresh behind a lease (`integrations/refreshLease.ts`), revoke, and
  a frozen tool allowlist. Connections are stored with
  `integrations.auth_type = 'oauth_mcp'`.
- #2404 ("Connector foundation · a shared MCP client") is the filed plan to
  generalise it: the `McpProvider` record, `mcpProviders.ts`, the `mcp`
  sign-in kind, and the optional custom connector.

### Native provider adapters: the connector library (D751–D757)

- `cloudflare-worker/src/integrations/registry.ts` is the single source of
  truth (`PROVIDERS`, `ProviderDescriptor`, `AuthType = api_key | oauth2 |
  webhook`).
- Adapters live in `integrations/providers/`: affinity, calendly, carta,
  crunchbase, docusign, github, hubspot, mercury, salesforce, slack, stripe.
- Feeds: `integrations/fed.ts`, `integrations/mappings/` and the
  `connector_fed_items` ledger.
- Company scope: `integrations/companyScope.ts`, the D713 guard.
- Secrets: `integrations/secrets.ts`. OAuth: `integrations/oauth.ts`.
- Pages: `GET /api/connectors/available` and
  `GET /api/connectors/directory/:key`.
- Planned providers: epic #2415 (#2398–#2409).

### The AI token ledger: built, and the only currency (D629, D755, D762, D783, D788, D791, D794)

| Piece | Where |
|---|---|
| Unit | integer **micro-USD** (`AI_USD_SCALE = 1_000_000`, `services/aiBudget.ts`). Pack face values are Stripe integer cents. |
| Plan allowance | `planAllowanceFor` (D783), per licence key (`aiLicenceKey`), monthly; spend in `ai_included_spend` |
| Bought balance | `ai_topup_accounts.balance_microusd`, `ai_credit_ledger` (migration 486), token packs (`aiCredits.ts`) |
| Hold before a run | `reserveAiBudget(env, userId, quoteMicrousd)`: one atomic `INSERT … SELECT` that splits the hold between allowance and balance and enforces the member's own monthly limit (D788) and pause (D791). Concurrent holds cannot overspend. |
| Settle after a run | `settleAiReservation(env, reservation, costMicrousd, refund)`: CAS on `settlement_uid`, so a replay is harmless. Over-hold costs go to `review` for a Super Admin (D640). Expired holds are released at the next read. |
| Usage record | `ai_usage_logs` (migrations 040, 493): task, model, tokens, `charged_microusd`, `reservation_uid`, `units_json`, `rail_page`, `record_ref` |
| Pricing | `services/ai/pricing.ts` (`chargeMultiplier`), `aiCatalog.ts` |
| Member reads | `aiSpend.ts`, `aiCost.ts`, `aiConsumption.ts`, `usageReport.ts`; routes `/api/ai-budget`, `/api/usage` |

- **Words.** Product copy says **"AI tokens"**, never "credits". "Credits"
  are Perks credits, a separate ledger (D755 §1, D793, and its guard test).
  The owner's "unified credits" means this AI token ledger.

### Member API keys: none

- `routes/settings.ts` returns `api_keys_enabled: false, api_keys: []` ("T20:
  off until the API tier ships").
- The Super Admin's Integration Keys page holds provider secrets, not member
  keys.
- DEVELOPER #2418 planned the member-facing page (`/account/developer/keys`).

### Runtime

| Thing | Where or what |
|---|---|
| Bindings | D1 `DB`; KV `TOKENS`, `RATE_LIMITS`, `OAUTH_KV`; Queue `JOB_QUEUE`; Durable Objects `PipelineRoom`, `OnboardingChat`; R2 `FILES` (wrangler.toml) |
| Tests | `npm run test:drift`. The Worker tests run on `node:sqlite` with `_d1_sqlite.mjs` and `_mem_kv.mjs`; `mcp_server_d666.test.ts` runs the whole OAuth flow for real. |
| Raw-interpolated SQL | 499 of under 500 (schema_guards). Every new statement is bound. |

## 2. Architecture decisions

1. **One endpoint, two credentials.** `/mcp` keeps OAuth for assistants that
   sign in, and also accepts a member API key (`Authorization: Bearer
   axk_…`). Both become the same `GrantProps`-shaped principal before
   `callTool`, so every check runs once, in one place.
2. **No second framework.** The tool registry stays `registerMcpTools`, and
   connectors stay `integrations/registry.ts`. The registry task adds a
   source field to `McpTool`: `axal`, `connector` or `remote_mcp`.
3. **Three patterns, kept apart internally.**
   - **A.** Axal tools served at `/mcp`.
   - **B.** Remote MCP servers through #2404's client.
   - **C.** Native adapters in `integrations/providers/`.

   A model API, such as Anthropic, OpenAI or xAI, is pattern C. It is never
   described as an MCP connection.
4. **Stateless by default.** `/mcp` stays stateless, as it is now.
   - A Durable Object is used only where a remote MCP server needs a held
     session (#2404 part 1 decides, per provider).
   - Multi-connector workflows run on `JOB_QUEUE`, with their state in D1.
5. **One currency.** Every billable operation reserves and settles through
   `reserveAiBudget` and `settleAiReservation`. There is no MCP balance and no
   API balance.
   - **Composite rule.** A tool that runs AI through `aiRouter` is charged by
     that run's own hold. A tool with its own fee (`price > 0` in the
     metering policy) takes a second hold under the same `execution_id`.
     Both rows name the execution, and neither charges the other's part.
6. **Idempotency.** Each call has an `execution_id`. A hold created with an
   idempotency key returns the existing hold on replay (migration 525, D844),
   and settlement is already CAS.
7. **Unknown is NULL.** Missing usage stays NULL, never 0, as in
   `ai_usage_logs` since 493.
8. **Keys and provider credentials are different objects.** Member keys live
   in `member_api_keys`. Provider tokens stay in the existing connector
   stores.

## 3. Contracts (stable for the Saturday UI)

These shapes are the contract the UI tasks build on. A task that changes
one updates this section in the same PR.

### Member API keys (D841; S21)

- **Key format.** `axk_<key_id>_<secret>`.
  - `key_id`: 12 characters `[a-z0-9]`, public, indexed.
  - `secret`: 32 random bytes in base64url, 43 characters.
  - Stored: `key_id` and `secret_sha256` (hex). The secret is never stored or
    logged.
- **Routes** (`routes/developer_keys.ts`, client `frontend/src/lib/api/developerKeys.js`; signed-in session only; a key can never manage keys):
  - `GET /api/developer/keys` returns `{ enabled: true, keys: [ { uid, name, key_id, prefix, scopes[], companies: [{id,name,still_owned}], created_at, last_used_at, expires_at, revoked_at, revoked_reason, monthly_limit_microusd, rate_per_minute } ], scopes_available: [{name,label,write}], companies_available: [{id,name}], max_live_keys: 25 }`. With the flag off the route is 404, which a page reads as "Not available yet"; `enabled` is always true when it answers.
  - `PATCH /api/developer/keys/:uid` takes `{ name?, monthly_limit_microusd? | null }` and returns `{ key }`. Scopes and companies never change; rotate or create instead. A revoked or expired key answers `409 not_live`.
  - `POST /api/developer/keys` takes `{ name, scopes[], companies[], expires_in_days | null, monthly_limit_microusd | null }` and returns `201 { key: {…as above}, secret: "axk_…" }`. **The only response that carries the secret.**
  - `POST /api/developer/keys/:uid/revoke` returns `{ key }`.
  - `POST /api/developer/keys/:uid/rotate` returns `201 { key, secret, replaced: {uid, revoked_at} }`. The new key copies the old one's name, scopes, companies and limit; the old one is revoked.
- **Create and change refusals** (400 unless noted): `invalid_body`, `invalid_name`, `invalid_scopes` (not grantable), `invalid_companies` (not owned), `invalid_expiry`, `invalid_limit`; `409 too_many_keys` (25 live); `409 not_live`; `403` in a support session; `401 session_required` when a key tries to manage keys.
- **Errors when a key is used** (short; never say whether a key exists):
  - `401 invalid_key`, `401 revoked_key`, `401 expired_key`;
  - `403 insufficient_scope`;
  - `402 insufficient_tokens`;
  - `429 rate_limited`, with `Retry-After`.
- **Flag.** `API_KEYS_ENABLED`. When it is off, every route answers 404 and
  `/mcp` refuses `axk_` tokens.

### Limits (D849; S14)

- **`GET /api/developer/limits`** (`routes/developer_limits.ts`, client `developerKeysApi.limits()`; signed-in session only, `401 session_required` for an `axk_` bearer) returns
  `{ window_seconds: 60, member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled, keys: [ { uid, name, prefix, rate_per_minute, monthly_limit_microusd|null } ] }`.
  Only live keys are listed; with `API_KEYS_ENABLED` off `keys` is empty and the caps still read.
- **The member limit** answers an MCP call over 120 a minute, across every connection and key (an in-app Eadwyn call with no grant is not counted), with the tool error *"Too many calls from your account across its connections. Wait a minute and try again."* and logs `rate_limited`.
- **`key_limit_reached`** (PR 2 of #2472): `402 { code: 'key_limit_reached', limit_microusd, used_microusd }` when a metered call would pass a key's monthly cap.
- **Alerts** (PR 2 of #2472), on D788's `notify()` path: type `api_key_limit` at 80% and 100% of a key's monthly cap, and type `api_key_failures` when more than 20% of at least 50 calls on a key fail within an hour.
- **A support session cannot buy AI tokens:** `POST /api/orders/intent` with a token pack under an impersonation token answers `403 { error: 'support_session_refused', message }`.

### Usage records (D843; S08) and reports (D845; S09)

- **`api_usage_events` row:**
  - who and where: `uid, user_id, api_key_uid|null, client|null, surface('mcp'|'api'), operation (tool or route), provider|null, connector|null, company_id|null`;
  - ids: `execution_id, request_id, idempotency_key|null`;
  - result: `outcome('ok'|'refused'|'error'|'rate_limited'|'insufficient_tokens'), http_status|null, error_category|null, duration_ms`;
  - money: `reservation_uid|null, reserved_microusd|null, charged_microusd|null, refunded_microusd|null, provider_cost_microusd|null`;
  - units: `input_tokens|null, output_tokens|null, units_json|null, pricing_version|null, created_at`.
- **`GET /api/developer/usage`** takes
  `?from&to&group=day|key|provider|connector|tool|model&key=&cursor=` and
  returns `{ recorded, totals: { calls, ok, errors, charged_microusd|null }, groups: [ { key, label, calls, errors, charged_microusd|null, p50_ms|null } ], next_cursor }`.
- **`GET /api/developer/usage/events`** takes `?key=&cursor=` and returns a
  page of rows, without arguments or results. Org reports wait on the admin
  scope decision (#2459 decision 3).

### Contract additions from the UI issues (#2479–#2482), and who builds each

| Gap | Owner |
|---|---|
| `GET /api/developer/tools`: `{ name, title, description, source, connector, required_scope, read_only, available, unavailable_reason }` | #2467 (D846) |
| Connector `health { state: ok\|degraded\|expired\|disconnected\|error, checked_at, error_category }`, plus the last ten checks | #2469 (D848) |
| Assistant grants list gains `scopes[]`, `companies[].still_owned` and `last_call_at` | #2467 (D846) |
| Key `PATCH`, `still_owned`, scope labels, refusal codes, the 25-key cap | #2464 (D841), done |
| `/usage/events` filters `from, to, outcome, surface, operation, provider, connector, company`; `grant_id`; the fixed `error_category` list | #2465 (D843) and #2471 (D845) |
| Report totals split `refused / rate_limited / insufficient_tokens / error`; `refunded_microusd`; `group=day&by=key` two-way grouping; `recorded_since`; `provider_cost_microusd` hidden from members | #2471 (D845) |
| A read of the limits in force (per key, per member) | #2472 (D849), done: `GET /api/developer/limits` |
| Per-key and failure alerts: store, route, notification type | #2472 (D849): named above, built in PR 2 |
| `GET /api/ai-budget/holds` (operation, surface, key, execution per hold; columns on `ai_budget_reservations` in migration 525) | #2466 (D844) |
| `GET /api/ai-budget/prices` (the metering policy as members read it) | #2466 (D844) |
| The `402 insufficient_tokens` body `{ code, needed_microusd, available_microusd, add_tokens_href }`; `spend_limit`, `ai_paused`, `budget_review` codes on `/mcp` | #2466 (D844) and #2470 (D842) |
| `key_limit_reached` | #2472 (D849): named above, built in PR 2 |
| A support session can buy AI tokens (`routes/orders.ts` has no `impersonated_by` check) | #2472 (D849), done: `403 support_session_refused` |

### Metering policy (D844; S10)

- `services/metering.ts`, with `METERING_POLICY = { version: 'm1-2026-10', tools: { [operation]: { price_microusd, unit: 'call'|'token'|'second'|'image', ai: boolean } } }`.
  - A tool with no entry is free and recorded as `charged_microusd = 0`, a
    known zero.
  - A provider-reported cost overrides the estimate at settlement.
- `meteredCall(env, { userId, executionId, operation, quoteMicrousd }, run)`
  does three things: reserve with the idempotency key, run, then settle at the
  actual cost or release on failure.

## 4. Security decisions

- **Key strength and lookup.** A key carries 256 bits of entropy, so a SHA-256
  hash is enough (as GitHub's tokens use). The lookup is by `key_id`, then a
  constant-time compare of the hash.
- **No escalation.** A key never grants more than its creator holds.
  - Its scopes must be ⊆ the scopes the creator can grant.
  - Its companies must be ⊆ `grantableCompanies` (owned ventures), the same
    rule as OAuth consent.
  - Both are re-checked on every call, as grants are, so a key loses a company
    the moment its creator does.
- **Endings.** "Sign out everywhere" (`jwt_min_iat`) ends keys created before
  it, as it ends grants. Revocation is immediate, because there is a D1 read
  on each call and no cache.
- **Limits.** Per key (default 60 a minute) and per user across keys and
  grants (default 120 a minute), both in `RATE_LIMITS` and fail-closed. The
  per-user limit is `withinUserLimit` (D849), counted under
  `mcp_rl:user:<id>` by every grant and key.
  Failed key lookups are throttled per IP (10 a minute), so keys cannot be
  enumerated.
- **Secrets stay out of everything.** No secret reaches a log, trace,
  analytics event, error message, activity line or AI prompt. A test asserts
  this for `console` and `activity_logs`, and `scripts/check-secret-logging.mjs`
  (D849, in `test:guards`) fails any `console.*`, `logActorAct` or
  `activity_logs` write that names a bearer, a secret or an `axk_` value.
- **Tool output is data.** It cannot change scopes, companies or prices.
  Authorization and metering run on the server before and after the tool,
  never inside it.

## 5. D1 migrations (numbers given by the issues)

| # | File | Task | What |
|---|---|---|---|
| 523 | `523_member_api_keys.sql` | S21 (D841) | `member_api_keys` |
| 524 | `524_api_usage_events.sql` | S08 (D843) | `api_usage_events` and its indexes |
| 525 | `525_ai_reservation_idempotency.sql` | S10 (D844) | `ai_budget_reservations.idempotency_key` with a unique partial index |
| 526 | `526_connector_flows.sql` | S24 (D853) | `connector_flow_runs`, `connector_flow_steps` |

All three are additive. A rollback is "stop reading the column or table";
nothing is dropped in production.

## 6. Session plan

| Phase | Task | Slot | Decision | Migration |
|---|---|---|---|---|
| Foundation | #2464 member API keys | S21 | D841 | 523 |
| Engine | #2470 `/mcp` accepts keys; execution ids, timeouts | S07 | D842 | — |
| Engine | #2465 usage events | S08 | D843 | 524 |
| Engine | #2466 metering on the AI token ledger | S10 | D844 | 525 |
| Registry and clients | #2467 one tool registry | S11 | D846 | — |
| Registry and clients | #2468 shared MCP client (#2404 part 1) | S12 | D847 | — |
| Registry and clients | #2469 connector contract and health | S13 | D848 | — |
| Reports and hardening | #2471 usage reports | S09 | D845 | — |
| Reports and hardening | #2472 security and limits | S14 | D849 | — |
| Reports and hardening | #2473 end-to-end and production readiness | S15 | D850 | — |
| Roadmap | #2474 model and coding providers | S22 | D851 | — |
| Roadmap | #2475 remote MCP servers a member adds | S23 | D852 | — |
| Roadmap | #2476 multi-connector flows | S24 | D853 | 526 |
| Roadmap | #2478 connector roadmap check | S25 | D855 | — |
| Roadmap | #2477 Eadwyn uses registry tools | S27 | D854 | — |
| UI (from Saturday 2026-10-24) | four Claude Design canvases, then build | S17–S20 | — | — |

**Order of work:**
- #2464 comes first.
- #2470 stacks on #2464.
- #2471 stacks on #2465.
- #2472 stacks on #2470.
- #2473 closes the backend phase.
- Everything else can start now.

## 7. Issues

The tasks are #2464 to #2478 (§6). The UI issues are listed on #2463.

## 8. Progress log

- **2026-10-21 (S21).**
  - Discovery done; this plan written.
  - Tasks #2464–#2478 filed to slots S07–S15, S21–S25 and S27.
  - S21 starts D841 (API keys) on `claude/adoring-knuth-ec95nr-mcp-engine`.
- **2026-10-22 (S14).** #2472 PR 1 (D849): the per-member limit across
  grants, `GET /api/developer/limits`, the support-session refusal on token
  packs, `check-secret-logging`, and the cross-tenant matrix with the
  prompt-injection check. PR 2 (`key_limit_reached`, the alerts, the key rows
  of the matrix) waits on #2470 and #2466.

## 9. Known limitations

- **Org-level reports and studio-scoped admin reads** wait on the owner's
  admin-scope decision (#2459 decision 3, #2450 decision 6).
- **Stripe live steps are the owner's.**
- **Model-provider adapters (D851) need provider accounts and keys,** which
  the owner supplies. Until then, only the groundwork and stubbed tests can be
  built.
