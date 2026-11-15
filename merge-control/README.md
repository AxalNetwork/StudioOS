# Merge Control

Independent GitHub App webhook Worker for issue leases and cancelling orphaned
merge-queue runs (D5618). No studioos imports, D1, KV, assets or deploy token.
The owner performs the initial deployment in D5618; the kill switch defaults on.

| Path | Purpose |
| --- | --- |
| `src/` | Webhook ingress, App authentication, repository Durable Object and pure policy in `src/lib/`. |
| `test/` | Node/SQLite policy, restart and ingress tests; runtime adapter is test-only. |
| `env.d.ts` | Wrangler-generated bindings; regenerate with the dedicated config. |
| `tsconfig.json` | Independent typecheck with the installed Worker types. |
| `contract/` | Pure contracts the studioos Worker also reads (D5624). |

`npm run test:merge-control` runs focused tests and typechecking inside the drift
suite. The deployed entrypoint is `src/index.ts`. Owner routes use a dedicated
Bearer token: GET /status, POST /switch {on}, POST /claims
{issue, operation, holder, fence?, ttlSeconds?}. Leases last at most 24 hours.
Save the returned fence and present it on renew/release. If the service cannot
be reached, use the claim ref CLI from #5617 and record the fallback in STATUS.
Ref mirrors are observation only; they never replace a live server lease.

D5620: `src/policy.ts` bundles the classifier `scripts/merge-policy.mjs` uses,
from `src/lib/classify.mjs`. The deploy job injects the commit as
`policy_version` with `--define`; a build without it fails at startup.
GET /status reports it. `src/policyCheck.ts` evaluates a compare and fails
closed; posting the check is #5990.
