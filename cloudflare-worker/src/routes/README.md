# Worker route handlers — production source of truth

These files are the production API behind `https://axal.vc/api/*`. They are
mounted by `cloudflare-worker/src/index.ts` and run on Cloudflare Workers
against D1 (`env.DB`), KV, R2, Vectorize, AI, Queues and Durable Objects.

## Mount map

`index.ts` mounts each router under `/api/<prefix>`. **This is a selected list,
not the whole set** — there are 155 `app.route()` calls in `index.ts` and 35
rows here, most of the remainder being the `/api/admin/*` family. `index.ts` is
the complete answer; this map exists to name the ones worth knowing first.

Every filename below is now checked. `check-folder-docs.mjs` used to read only
backticked tokens, so names sitting bare inside this fence were invisible to
it — which is how the row for `/api/market-intel` came to point at a hyphenated
spelling of `market_intel.ts` that has never existed, while a guard written to
catch exactly that ran green over this folder. The guard reads fenced blocks as
of 2026-09-07. (Naming the wrong spelling in backticks here would fail the
widened guard on this very sentence, which is the rule working.)


```
/api/admin/partner-settlements → partner_settlements.ts (HQ drafts; Super Admin issue/void, D713)
/api/partner-settlements → partner_settlements.ts (own non-draft settlements, D713)
/api/mercury/personal → mercury_personal.ts (a member's own Mercury (founders, partners, and investors on HQ): status, payment matches and raise receipts, read-only, D713, D752)
/api/mercury/attestations → mercury_attestations.ts (an investor's proof of capital: dated statements from their own Mercury, consented and revocable; read-only, HQ only, D752)
/api/admin/capital-attestations → admin_capital_attestations.ts (HQ admins read an investor's shared proof of funds; audited before it answers; reads capital_attestations only, never a connection; D752)
/api/testing/mail  → testing_mail.ts (D811: programme-signed preferences and one-click unsubscribe; no newsletter opt-in required)
/api/mail-link     → mail_link.ts (D811: Mail HMAC only, before session middleware; audiences, recipients, feedback and health)
/api/auth          → auth.ts
/api/scoring       → scoring.ts
/api/projects      → projects.ts
/api/cycles/build  → cycle_build.ts      (Build overview, six module reads, D662 field writes, and D686 system mappings)
/api/legal         → legal.ts
/api/legalcap      → legalcap.ts
/api/partners      → partners.ts
/api/partnernet    → partnernet.ts
/api/partner/…     → partner_pipeline.ts  (the partner WORKSPACE's own stores)
/api/capital       → capital.ts
/api/tickets       → tickets.ts
/api/deals         → deals.ts
/api/portfolio-support → portfolio_support.ts  (the IP3 value-add ledger, D70)
/api/founder/validate → founder_validate.ts, founder_validate_sessions.ts  (D657's interview sessions: /interviews/:id/sessions, /sessions/*; D685's one-call setup POST /sessions and PUT /sessions/:id/points/:pointId; its processing POST /sessions/:id/{finish,process,summarise}; GET /sessions/active)
/api/portfolio-updates → portfolio_updates.ts  (founder updates; D654/D686 Share an update: venture and open-call context, shipped facts, validated audience, retry-safe send, co-founder authors, author/recipient pages)
/api/cycles/grow   → cycle_grow.ts  (D664/D686: the Grow overview, module reads including update ask replies and Updates history, and store writes; shared card types live in cycleCards)
/api/cycles/raise  → cycle_raise.ts  (D663: the Raise overview, module reads and the readiness, narrative, checklist and next-step writes)
/api/users         → users.ts
/api/market-intel  → market_intel.ts
/api/market-intel-public → market_intel_public.ts
/api/advisory      → advisory.ts
/api/activity      → activity.ts
/api/admin         → admin.ts
/api/private-data  → private-data.ts
/api/monitoring    → monitoring.ts
/api/ai-budget     → ai_budget.ts       (member allowance/held reads; Super Admin reviews and plan caps, D640; D755: GET /top-up packs and latest purchase, GET /history, and the Super Admin's /members/:userId, /members/:userId/adjustments and /reconcile; D776: GET /runs, the member's own runs grouped by page, option or record)
/api/admin/catalog/token-packs → catalog.ts (D755: the Super Admin creates, adopts, changes and archives token packs; the generic catalog writes refuse a pack)
/api/public/plans-and-packs → public.ts (D755: every plan's price and AI allowance and the packs on sale; D1 only, no session)
/api/usage         → usage.ts           (the caller's own stored files by area, across all their companies; never another member's, D642)
/api/connectors    → integrations.ts    (canonical connection catalogue, company scope, requests, suggestions and logs; D650; connector pages (`GET /directory/:key`, D753))
/api/integrations  → integrations.ts    (temporary alias to the same handlers; D650)
                                         (D655: GET /:uid/sync-status, GET /:uid/fed, GET|PUT /:uid/repositories for GitHub)
/api/infra         → infra.ts
/api/funds         → funds.ts
/api/fund-fees     → fund_fees.ts       (D709: the management fee's terms, admissions, net invested capital, offsets, and fee periods the GP previews and issues; moves no money)
/api/fund-admin    → fund_admin.ts      (D714: GET /access, which fund acts this admin may take, from FUND_ACTS)
/api/fund-reporting → fund_reporting.ts
/api/fund-booklets → fund_booklets.ts (D716: the Subscription Booklet, the applicant's ticks, paper and submit, HQ's read, PDF and withdraw; the e-sign send and the GP's acceptance (D759))
/api/fund-notices  → fund_notices.ts    (D716: an Admin previews, the Super Admin issues, the LP reads their own; kept PDFs through Browser Run)
/api/liquidity     → liquidity.ts
/api/email         → email.ts
/api/pipeline      → pipeline.ts
/api/search        → search.ts
/api/kyc           → kyc.ts
/api/legal/esign   → esign.ts            (frontend calls /api/legal/esign/*)
/api/network       → network.ts
/api/networkfx     → networkfx.ts
/api/profiling     → profiling.ts
/api/profile       → profile_history.ts, founder_profile.ts  (D702: the founder's /me, /venture and /preview after the archetype history reads)
/api/dashboard     → dashboard.ts
/api/matches       → matches.ts         (Best-Fit's /summary only; the AI Matching Engine was removed)
/api/research      → research.ts        (the Research bucket's own stores)
/api/research      → research_markets.ts (markets and geographies, through the D533 crosswalk)
/api/advisor-grants → advisor_grants.ts (a founder's per-scope grant to a named advisor)
/api/learning      → learning.ts        (the Learning center, member side: catalog, courses, items, progress; D557)
/api/admin/learning → admin_learning.ts (authoring the Learning center; Super Admin only; D557)
/api/learning      → learning_assessment.ts (exercises and exams, graded on the server; D559)
/api/admin/learning → admin_learning_assessment.ts (authoring exercises and exams, reviewing submissions; D559)
/api/admin/money-rails → admin_money_rails.ts (each Axal entity's role and each money kind's rail; admin only; D707)
/api/ai           → ai.ts              (the caller's own AI spend, by task, page, model and day; the rate card at /rates, D641; GET /catalogue, the offered models with cost and billed unit prices, and cost and billed on /pricing and /rates, D760)
/api/ai/rail/proposals → ai_rail_proposals.ts (D780: the caller's own drafts, proposals and notes from a rail option's run, `ai_rail_proposals`; GET by option and record, POST /:uid/decide accept, edit or discard)
/api/founder/validate → founder_validate_structure.ts (structure a session's transcript, compare two runs, ask it; accept, edit then accept or discard each placement; D658. Since D757 (#1925) `POST /sessions/:id/placements/accept` is Accept all, for a module (`{ slug }`) or chosen placements (`{ ids }`, at most 50): each placement's own claim and writer, every outcome reported)
/api/founder/validate → founder_validate_meetings.ts (D684: schedule, list, cancel and import a Zoom or Google Meet call on an interview)
/api/channels         → founder_validate_meetings.ts `zoomWebhook` (the public Zoom webhook, mounted first), then channels.ts (D684: Telegram and WhatsApp connections, the conversation inbox, replies, and their public webhooks; D754: consent requests in the chat and the member's word)
/api/admin/channels   → channels.ts `channelsAdmin` (D684: the channels bot's setWebhook and its health read, D756; super admin)
/api/admin/bank-accounts → admin_bank_accounts.ts (D708: each Axal entity's bank accounts, masked, with add, relabel, purposes, retire and a recorded reveal; Super Admin, HQ only; mounted beside /api/admin/stripe, before the /api/admin catch-all)
/api/admin/fund-structure → admin_fund_structure.ts (D717: the entity and money map, read-only; masked accounts for the Super Admin, and each entity's active accounts masked (#1855); #1773's sentence for a plain Admin; HQ only; mounted beside /api/admin/bank-accounts, before the /api/admin catch-all)
/api/admin/mercury    → admin_mercury.ts (D710: each Axal entity's read-only Mercury connection, its accounts, transactions and reconciliation matches, and D749's Not ours marks; connect is the Super Admin's behind the write bar, the rest an Admin's on HQ)
/api/eadwyn       → eadwyn.ts          (the Worker AI rail's conversations, their connector switches, and Send/Cancel for a write Eadwyn proposed; D652)
/api/wellbeing     → wellbeing.ts       (check-ins, the expert directory and bookings; sample experts are seeded outside production only and never shown to members, D643)
/api               → realtime.ts (WebSocket fan-out, Durable Objects)
```

Prefixes mirror the FastAPI routers in `backend/app/api/routes/*.py` so the
local FastAPI dev backend exposes the same `/api/...` paths the frontend
calls in production.

### Build operating systems (D686)

`GET /api/cycles/build/systems/choices?project=<id>` returns the caller's own
company-enabled connector choices by system kind. Workspace choices come from
the caller's personal Google Calendar or Microsoft 365 token. A caller outside
the project's company receives `403 not_in_company`.

`PUT /api/cycles/build/systems/:kind?project=<id>` maps one of `bank`,
`accounting`, `payroll`, `crm`, or `workspace`. For connector kinds, send
`integration_uid` (or the legacy numeric `integration_id`); `null` unmaps.
Workspace takes `provider_key` (`google_calendar` or `microsoft_365`) instead;
`null` unmaps. The caller must own the enabled connector or Workspace token
and belong to the project's company. The route records the actor. Refusals
include `400 invalid_kind`, `400 kind_mismatch`, `403 not_in_company`,
`403 workspace_not_connected`, and `409` when the project has no company.
An unowned or company-disabled connector also returns `403`.

`GET /api/cycles/build/modules/operating-systems?project=<id>` includes
`parts.tools` with `cols`, `rows`, and `total`: Tool, Category, State, Last
good sync, Failed at (`integrations.last_error_at`), Feeds, Owner, and an Open
action. Its facts include `tools_connected`, `tools_failing`, and `tools_total`.
The rows include only company-enabled connectors whose owner remains a company
member; personal Workspace connections are excluded. A member sees teammate
names, while an admin or partner outside the company sees no teammate name.

## Known gaps vs the FastAPI dev backend

These FastAPI routers in `backend/app/api/routes/` have no worker
counterpart. Calls hit the worker as 404. The frontend touches some of these,
so re-implementing them on the worker (or accepting the broken UI affordance)
is a follow-up:

- `pipeline_votes.py` — `/api/pipeline/vote*`, `/api/pipeline/votes*` (used by
  the deal-card voting widget). The worker `pipeline.ts` only handles
  `/active`, `/projects/*`, `/ws/*` — voting endpoints are missing.
- `company.py` — `/api/company/*`. No frontend usage spotted, but FastAPI
  exposes it; flagged for parity.

These have been broken on prod whether the worker proxied or not (the proxy
target was never deployed). Re-implementing them is out of scope for the
"restore login" patch.

## Why the worker owns the API (not FastAPI)

An earlier "audit #4" plan proposed making FastAPI the canonical backend and
turning this worker into a thin proxy. That migration was never completed:
the 23 production user accounts live in D1, which the FastAPI process can't
reach, and FastAPI was never deployed publicly. The worker is therefore the
canonical production API. FastAPI in `backend/` stays as the local dev
backend so you can iterate without round-tripping through Cloudflare.

If you ever decide to revisit the FastAPI-canonical plan, you'll need to:

1. Migrate the D1 user/session data to whatever DB FastAPI talks to.
2. Deploy FastAPI publicly (e.g. Replit Deployment, Fly, Render).
3. Turn `index.ts` back into a `FASTAPI_ORIGIN` proxy.
4. Keep `realtime.ts` mounted at the edge (Durable Objects can't move).

Until that work happens, treat the files in this folder as the live API.

D647 (#1441): `admin_contracts.ts` is mounted at `/api/admin/contracts` in
`index.ts`. It provides the four-source agreement union, validated bound
filters/paging/search and null-last sorting, stats, recipient/deal pickers,
template fields and existing template/actions/download reads. Union list/stats
fail with 503 Unreadable rather than inventing empty sources. The separate
`admin_contract_doc_registry.ts` mount at `/api/admin/contracts/registry` is
canonical Super Admin only. Migration 434 records explicit published template snapshots. The new guided
preview/send routes verify the same version and body fingerprint, and history
and signed-PDF routes project safe fields and hash the actual PDF bytes. The
new desk opts into recorded send-event dates with `recorded=true`.

D659 (#1472): `cycle_validate.ts` is mounted at `/api/cycles/validate` in
`index.ts`. It serves #1469's shared cycle read for Validate. `GET /overview`
returns four figures and six cards, and `GET /modules/:slug` returns one card
plus its records (search, filters, sort, pages). The manual writes for
migration 440's records go through `../services/validateWriters.ts`. Reading
follows the founder board's `canReadBoard` rule and writing follows
`canWrite`. A card whose store fails is `unreadable` on its own. See
`documentation/architecture/decisions/D659.md`.

D693 (#1704): Verdict is the seventh module `cycle_validate.ts` serves. The
overview adds the Verdict card only for a viewer `canReadDecision` admits, and
`GET /modules/verdict` refuses anyone else with 403 "Partners do not see
decisions." before reading anything. Every Validate read sends
`can_read_decisions`. Decisions are recorded through `cycle_verdict.ts`
(`POST /api/cycles/validate/decisions`), and each one's record, activity,
actions and form-options are `../services/records/verdict.ts`'s. See
`documentation/architecture/decisions/D693.md`.

D663 (#1476): `cycle_raise.ts` is mounted at `/api/cycles/raise` in
`index.ts`. `GET /overview` returns the four Raise figures and seven cards,
and `GET /modules/:slug` returns one card plus its records. The reads are
`../services/raiseCycle.ts`; the writes are `../services/raiseWriters.ts`:
D663's five (a readiness score, the computed rescore, a narrative version, a
data-room file's checklist item, a prospect's next step and warm path) and,
since D691 (#1700), one behind each Add and Edit form (a version's edit, a
deck link, a cap-table holder, the use-of-funds split, an investor), each
logging its record's row through `logCycleWrite`. Reading and writing both
follow `canWrite`: the cards carry the cap table, the investor pipeline and
who opened the data room. `decks.ts`'s share
heartbeat also takes `slides`, the viewer's seconds per slide, stored through
`../services/deckSlideDwell.ts`. See
`documentation/architecture/decisions/D663.md`.

D653: `round_calls.ts` mounts `/api/round-calls`. Every operational route checks the default-off flag. Founder writes require venture ownership and verified active-company scope; investor reads/responses require active investor role, approved KYC and recipient entitlement; counsel reads/approval require HQ plus Super Admin, with fresh step-up on approval writes. D686 (#1594) adds owner counsel requests and the independent Super Admin counsel queue (registered before the UID route); request notices are emitted only after the winning audited write commits. Structured key terms, commitment dates and privacy-limited audience facts are stored/read by the Worker. Actual writes record the actor in activity_logs. `portfolio_updates.ts` links capital asks to an open private call without granting additional access.

D667 (#1497): the assistant interview tools are service functions in
`../services/assistantInterviews.ts`, registered through D669's common callTool gate on #1496's MCP server, not
routes of their own. Two routes here changed:
- `founder_validate_structure.ts`'s `GET /sessions/:id/placements` now gives
  each placement and run a `source` (`assistant` or `studioos`) and the
  assistant's `submitted_via_name`.
- Deleting a session (`founder_validate_sessions.ts`) now deletes its pending
  proposals. See `documentation/architecture/decisions/D667.md`.

D757 (#1897): `founder_validate_structure.ts`'s accept response gains `pain`
(`mention` and `group_id`) for an accepted pain, and `GET
/sessions/:id/placements` gives each pain its `theme` and, once that theme is
deleted, `theme_missing`.

D666: `mcp_consent.ts` mounts `/api/mcp/consent` and `/api/connectors/assistants` (the latter before the connector router). They are the SPA's half of connecting an AI assistant: read, approve or deny a parked authorization request (single-use, ten minutes), list the caller's grants and revoke one. The MCP server and its OAuth endpoints are not routers here: `../index.ts`'s `fetch` sends `/api/mcp`, `/api/oauth/*` and the two `/.well-known/oauth-*` paths to `../mcp/oauth.ts` first. Everything is 404 with `MCP_SERVER_ENABLED` off.

D686 (#1592): `integrations.ts` returns the signed OAuth destination `/build/connect`, exposes connector `feed_modules` and `last_error_at`, and keeps existing connections syncing on Free. Google Calendar, Microsoft and LinkedIn accept the literal Build return token in their existing callback flows.

D753 (#1878): `catalogueEntry` builds each catalogue item for `/available` and for `GET /directory/:key`, the descriptive page read registered above `/:key`. The page fields come from `../integrations/connectorPages.ts` through the registry. `crunchbase.ts`'s `connect_path` and the onboarding checklist's `ef.stripe`, `ef.plaid` and `inv.crm` steps link to `connectorPagePath(key)`, the connector's own page (#1946).

D691 (#1696): Grow obligation routes use the production `compliance_events`
columns (`due_date`, `completion_status`), translate the existing API keys in
TypeScript, require a due date and record manual provenance and the entity’s
jurisdiction. Duplicate event/date writes return 409.
