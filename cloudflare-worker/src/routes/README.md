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
/api/auth          → auth.ts
/api/scoring       → scoring.ts
/api/projects      → projects.ts
/api/cycles/build  → cycle_build.ts      (Build overview, six module reads, and D662 field writes)
/api/legal         → legal.ts
/api/legalcap      → legalcap.ts
/api/partners      → partners.ts
/api/partnernet    → partnernet.ts
/api/partner/…     → partner_pipeline.ts  (the partner WORKSPACE's own stores)
/api/capital       → capital.ts
/api/tickets       → tickets.ts
/api/deals         → deals.ts
/api/portfolio-support → portfolio_support.ts  (the IP3 value-add ledger, D70)
/api/founder/validate → founder_validate.ts, founder_validate_sessions.ts  (D657's interview sessions: /interviews/:id/sessions, /sessions/*)
/api/portfolio-updates → portfolio_updates.ts  (founder updates; D654's Share an update: /share/*, /:uid/share|send|page, /asks/:uid/*)
/api/cycles/grow   → cycle_grow.ts  (D664: the Grow overview, module reads and store writes; its shared card types live in the services folder as cycleCards)
/api/cycles/raise  → cycle_raise.ts  (D663: the Raise overview, module reads and the readiness, narrative, checklist and next-step writes)
/api/users         → users.ts
/api/market-intel  → market_intel.ts
/api/market-intel-public → market_intel_public.ts
/api/advisory      → advisory.ts
/api/activity      → activity.ts
/api/admin         → admin.ts
/api/private-data  → private-data.ts
/api/monitoring    → monitoring.ts
/api/ai-budget     → ai_budget.ts       (member allowance/held reads; Super Admin reviews and plan caps, D640)
/api/usage         → usage.ts           (the caller's own stored files by area, across all their companies; never another member's, D642)
/api/connectors    → integrations.ts    (canonical connection catalogue, company scope, requests, suggestions and logs; D650)
/api/integrations  → integrations.ts    (temporary alias to the same handlers; D650)
                                         (D655: GET /:uid/sync-status, GET /:uid/fed, GET|PUT /:uid/repositories for GitHub)
/api/infra         → infra.ts
/api/funds         → funds.ts
/api/liquidity     → liquidity.ts
/api/email         → email.ts
/api/pipeline      → pipeline.ts
/api/search        → search.ts
/api/kyc           → kyc.ts
/api/legal/esign   → esign.ts            (frontend calls /api/legal/esign/*)
/api/network       → network.ts
/api/networkfx     → networkfx.ts
/api/profiling     → profiling.ts
/api/dashboard     → dashboard.ts
/api/matches       → matches.ts         (Best-Fit's /summary only; the AI Matching Engine was removed)
/api/research      → research.ts        (the Research bucket's own stores)
/api/research      → research_markets.ts (markets and geographies, through the D533 crosswalk)
/api/advisor-grants → advisor_grants.ts (a founder's per-scope grant to a named advisor)
/api/learning      → learning.ts        (the Learning center, member side: catalog, courses, items, progress; D557)
/api/admin/learning → admin_learning.ts (authoring the Learning center; Super Admin only; D557)
/api/learning      → learning_assessment.ts (exercises and exams, graded on the server; D559)
/api/admin/learning → admin_learning_assessment.ts (authoring exercises and exams, reviewing submissions; D559)
/api/ai           → ai.ts              (the caller's own AI spend, by task, page, model and day; the rate card at /rates, D641)
/api/founder/validate → founder_validate_structure.ts (structure a session's transcript, compare two runs, ask it; accept, edit then accept or discard each placement; D658)
/api/eadwyn       → eadwyn.ts          (the Worker AI rail's conversations, their connector switches, and Send/Cancel for a write Eadwyn proposed; D652)
/api/wellbeing     → wellbeing.ts       (check-ins, the expert directory and bookings; sample experts are seeded outside production only and never shown to members, D643)
/api               → realtime.ts (WebSocket fan-out, Durable Objects)
```

Prefixes mirror the FastAPI routers in `backend/app/api/routes/*.py` so the
local FastAPI dev backend exposes the same `/api/...` paths the frontend
calls in production.

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

D663 (#1476): `cycle_raise.ts` is mounted at `/api/cycles/raise` in
`index.ts`. `GET /overview` returns the four Raise figures and seven cards,
and `GET /modules/:slug` returns one card plus its records. The reads are
`../services/raiseCycle.ts`; the five writes (a readiness score, the computed
rescore, a narrative version, a data-room file's checklist item, a prospect's
next step and warm path) are `../services/raiseWriters.ts`, each recording its
actor. Reading and writing both follow `canWrite`: the cards carry the cap
table, the investor pipeline and who opened the data room. `decks.ts`'s share
heartbeat also takes `slides`, the viewer's seconds per slide, stored through
`../services/deckSlideDwell.ts`. See
`documentation/architecture/decisions/D663.md`.

D653: `round_calls.ts` mounts `/api/round-calls`. Every operational route checks the default-off flag. Founder writes require venture ownership and verified active-company scope; investor reads/responses require active investor role, approved KYC and recipient entitlement; counsel reads/approval require HQ plus Super Admin, with fresh step-up on approval writes. Actual writes record the actor in activity_logs. `portfolio_updates.ts` links capital asks to an open private call without granting additional access.

D667 (#1497): the assistant interview tools are service functions in
`../services/assistantInterviews.ts`, registered through D669's common callTool gate on #1496's MCP server, not
routes of their own. Two routes here changed:
- `founder_validate_structure.ts`'s `GET /sessions/:id/placements` now gives
  each placement and run a `source` (`assistant` or `studioos`) and the
  assistant's `submitted_via_name`.
- Deleting a session (`founder_validate_sessions.ts`) now deletes its pending
  proposals. See `documentation/architecture/decisions/D667.md`.

D666: `mcp_consent.ts` mounts `/api/mcp/consent` and `/api/connectors/assistants` (the latter before the connector router). They are the SPA's half of connecting an AI assistant: read, approve or deny a parked authorization request (single-use, ten minutes), list the caller's grants and revoke one. The MCP server and its OAuth endpoints are not routers here: `../index.ts`'s `fetch` sends `/api/mcp`, `/api/oauth/*` and the two `/.well-known/oauth-*` paths to `../mcp/oauth.ts` first. Everything is 404 with `MCP_SERVER_ENABLED` off.
