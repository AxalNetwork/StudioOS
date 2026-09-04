# util — small shared helpers

No domain logic and no HTTP. If a helper knows what a deal or a fund is, it
belongs in `../services/`.

| File | What it does |
| --- | --- |
| `d1Retry.ts` | `withD1Retry` — retries transient D1 errors, and **rethrows non-transient ones immediately** rather than retrying a real bug. |
| `schemaBootstrap.ts` | `runSchemaBootstrap` — runs a self-healing schema bootstrap against a `users` table that is at D1's 100-column limit. Skips an `ADD COLUMN` whose column already exists (on a full table SQLite reports `too many columns` for those too, which is what 500'd `/api/introductions/*`), and **still throws, naming the side-table remedy, when a column is genuinely missing**. |
| `pagination.ts` | Limit/offset clamping. |
| `url.ts` | URL parsing and safety. |
| `zip.ts` | Zip assembly for exports. |
| `hashEmail.ts` | Email hashing for privacy-preserving lookups. |
| `stripeError.ts` | Parses Stripe errors into a status/code/type shape. |
| `stripeTax.ts` | Tax handling. |
| `paymentMode.ts` | Live vs test mode resolution. |
| `marketIntelTier.ts` | Market-intel entitlement helper. |
| `useOfFunds.ts` | `normalizeUseOfFunds` — validates the split sums to 100. |
| `cronHistory.ts` | Records scheduled-run outcomes. |
| `reembedSweep.ts` | Re-embedding sweep for vector search. |
| `usersRoleRebuild.ts` | Role recomputation. |
| `webauthn.ts` | Passkey primitives. |
| `thrownResponse.ts` | `withThrownResponses` — lets a gate that refuses by **throwing** a `Response` produce that Response. Hono re-throws non-`Error` values past `app.onError`, so without this the nine throwing gates (tier upsells, the fund 404) escaped to the runtime as worker exceptions. |
