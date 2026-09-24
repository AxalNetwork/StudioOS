# util — small shared helpers

No domain logic and no HTTP. If a helper knows what a deal or a fund is, it
belongs in `../services/`.

| File | What it does |
| --- | --- |
| `d1Retry.ts` | `withD1Retry` — retries transient D1 errors, and **rethrows non-transient ones immediately** rather than retrying a real bug. |
| `schemaBootstrap.ts` | `runSchemaBootstrap` — runs a self-healing schema bootstrap against a `users` table that is at D1's 100-column limit. Skips an `ADD COLUMN` whose column already exists (on a full table SQLite reports `too many columns` for those too, which is what 500'd `/api/introductions/*`), and **still throws, naming the side-table remedy, when a column is genuinely missing**. |
| `pagination.ts` | Limit/offset clamping. |
| `url.ts` | URL parsing and safety. |
| `branch.ts` | `branchOf`, `authCookieName`, `csrfCookieName` — which subsidiary this Worker serves, read from `BRANCH_CODE`, and the per-branch cookie names that keep a branch session on its host (D104). A malformed code **throws** rather than reading as HQ. |
| `zip.ts` | Zip assembly for exports. |
| `hashEmail.ts` | Email hashing for privacy-preserving lookups. |
| `stripeError.ts` | Parses Stripe errors into a status/code/type shape. |
| `stripeTax.ts` | Tax handling. |
| `paymentMode.ts` | Live vs test mode resolution. |
| `marketIntelTier.ts` | Market-intel entitlement helper. |
| `useOfFunds.ts` | `normalizeUseOfFunds` — validates the split sums to 100. |
| `cronHistory.ts` | Everything `cron_run_history` means, in one module (D201): the two writers (`writeCronRunHistory` for a tick that ran, `recordLeaseHeldFire` for one that found the lease held and wrote a `deduped` or `skipped` row instead of nothing), the one indexed reader (`latestRunPerTrigger`), `CRON_TRIGGERS` (the six declared expressions, asserted equal to both `wrangler.toml` tables) and `triggerState` (never → stale → failed → ok, each trigger against its own schedule). |
| `cronSchedule.ts` | `nextCronRun` / `prevCronRun` — five-field cron matching over UTC minutes in **Cloudflare's** dialect, where the weekday field runs 1 = Sunday to 7 = Saturday. Refuses (returns null) anything it does not read — names, `L`, `W`, `#`, `?`, a bare `a/n`, and an expression restricting both day fields — rather than guessing. Answers in `cron_run_history`'s own `YYYY-MM-DD HH:MM:SS`. |
| `reembedSweep.ts` | Re-embedding sweep for vector search. |
| `supportSessionSweep.ts` | `closeExpiredSupportSessions` — stamps `ended_at` on the audit row an HQ support session leaves on a branch. Written because nothing could: the branch writes that row with `admin_user_id = 0` and the repo's only `SET ended_at` is an HQ route whose predicate binds an id AUTOINCREMENT guarantees is never 0, so every branch session read as an open impersonation for ever. The end time is `started_at + SUPPORT_SESSION_MINUTES`, the instant the token died, not whenever the sweep ran. Ordinary impersonations are excluded on purpose — they can be extended, so their expiry is not derivable from this table. |
| `usersRoleRebuild.ts` | Role recomputation. |
| `webauthn.ts` | Passkey primitives. |
| `deadline.ts` | `withDeadline` — an await that cannot hang for ever, for the remote calls that take no `AbortSignal` (KV, D1). Throws `DeadlineExceeded` so a `catch` that already implements the failure policy covers a stall too. A `fetch` should use `AbortSignal.timeout` directly instead. |
| `thrownResponse.ts` | `withThrownResponses` — lets a gate that refuses by **throwing** a `Response` produce that Response. Hono re-throws non-`Error` values past `app.onError`, so without this the nine throwing gates (tier upsells, the fund 404) escaped to the runtime as worker exceptions. |
| `clientIp.ts` | `clientIp` — the address Cloudflare observed: `cf-connecting-ip` first, else the first hop of `x-forwarded-for`, else `unknown`, clipped to 64 characters. Written because `cofounder.ts` read `x-forwarded-for` first and stored it on `nda_signed_ip_a` / `nda_signed_ip_b`, so a signer could put any address they liked into an NDA-evidence field (D219). |
