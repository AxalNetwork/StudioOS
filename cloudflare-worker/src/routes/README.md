# Worker route handlers — DEPRECATED

As of the audit consolidation (see audit #4), **none of the files in this
folder are mounted by `cloudflare-worker/src/index.ts`** except `realtime.ts`.

FastAPI (`backend/`) is now the canonical API. The Cloudflare Worker is a
thin edge proxy/cache. See:

- `cloudflare-worker/src/index.ts` — proxies `/api/*` to FastAPI.
- `PRODUCTION.md` — production architecture and deploy steps.

## What's still active

- `realtime.ts` — WebSocket fan-out via Durable Objects. Must run at the
  edge; FastAPI is request/response only.

## What's archived (still here for git history)

Everything else: `auth.ts`, `scoring.ts`, `projects.ts`, `legal.ts`,
`partners.ts`, `capital.ts`, `deals.ts`, `tickets.ts`, `users.ts`,
`admin.ts`, `activity.ts`, `market-intel.ts`, `advisory.ts`, etc.

These are kept so we can:
1. Reference legacy behavior when re-implementing on FastAPI.
2. Diff old vs new during the migration.

**Do not re-mount these from `index.ts`.** Two sources of truth are how the
audit found us with drifted auth, scoring, and capital semantics in the
first place.
