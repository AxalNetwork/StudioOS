# Worker route handlers — production source of truth

These files are the production API behind `https://axal.vc/api/*`. They are
mounted by `cloudflare-worker/src/index.ts` and run on Cloudflare Workers
against D1 (`env.DB`), KV, R2, Vectorize, AI, Queues and Durable Objects.

## Mount map

`index.ts` mounts each router under `/api/<prefix>`:

```
/api/auth          → auth.ts
/api/scoring       → scoring.ts
/api/projects      → projects.ts
/api/legal         → legal.ts
/api/legalcap      → legalcap.ts
/api/partners      → partners.ts
/api/partnernet    → partnernet.ts
/api/partner/…     → partner_pipeline.ts  (the partner WORKSPACE's own stores)
/api/capital       → capital.ts
/api/tickets       → tickets.ts
/api/deals         → deals.ts
/api/users         → users.ts
/api/market-intel  → market-intel.ts
/api/advisory      → advisory.ts
/api/activity      → activity.ts
/api/admin         → admin.ts
/api/private-data  → private-data.ts
/api/monitoring    → monitoring.ts
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
/api/matches       → matches.ts
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

- `integrations.py` — `/api/integrations/*` (used by `IntegrationsPage`
  webhook config). No worker file exists.
- `admin_contracts.py` — `/api/admin/contracts/*` (used by the admin
  contract-download UI in `frontend/src/lib/api.js`). No worker file exists.
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
