# cloudflare-worker/src — the production API

This is what runs at `https://axal.vc/api/*`. Hono on Cloudflare Workers,
against D1 (`env.DB`), KV, R2, Vectorize, Workers AI, Queues and Durable
Objects.

**This — not `backend/` — is production.** The FastAPI app in `backend/` exists
for local Replit iteration and is never deployed; Workers do not run Python.
New features are implemented here first.

Deploy with `npm run deploy` from the repo root. Never `npx wrangler deploy` by
hand: it skips the `predeploy` hook that applies D1 migrations, and ships the
worker ahead of its schema.

| File | What it is |
| --- | --- |
| `index.ts` | Every mount. The route table for the whole API. |
| `auth.ts` | `requireAuth` and session resolution. |
| `db.ts` | `getSQL(c.env)` — the tagged-template shim. Every `${}` becomes a bound `?`. |
| `kv.ts` | KV helpers. |
| `types.ts` | The `Env` binding shape. |
| `personas.ts` | Role and persona constants. |
| `queue-consumer.ts` | The queue handler. |

## Subtrees

| Folder | What lives there |
| --- | --- |
| `routes/` | The HTTP surface — one router per `/api/<prefix>`. |
| `services/` | Logic the routes call. No HTTP in here. |
| `middleware/` | Tier gates, rate limits, tenancy. |
| `integrations/` | Third-party providers (Carta, Stripe, calendars, …). |
| `models/` | Row types. |
| `templates/` | Legal document and email templates. |
| `durable-objects/` | Realtime coordination. |
| `data/` | Seed and reference data. |
| `util/` | Small shared helpers. |

## Rules that have bitten people

- **D1 is SQLite.** It rejects a whole statement on an unknown column. A typo in
  one column name takes the entire query down — and if the handler swallows it,
  the surface just renders empty. `check-sqlite-columns` exists because of this.
- **Tenancy goes through `services/tenancyScope.ts`**, not an ad-hoc
  `WHERE user_id = ?` written inline for the fifth time.
- **Money is integer cents**, everywhere, and CI greps for float parsing on
  money fields.
- **Signed and issued documents are immutable** — R2 object-lock, hash in D1.
- **A new binding goes in BOTH tables in `wrangler.toml`** — the top level and
  `[env.production]`. `check-wrangler-binding-parity` fails otherwise.
