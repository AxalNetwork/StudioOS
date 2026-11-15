# Merge Control source

| File | Purpose |
| --- | --- |
| `index.ts` | Public ingress and authenticated owner routes, Queue and cron handlers. |
| `webhook.ts` | Bounded raw-body HMAC verification and owner token checks. |
| `repoControl.ts` | One object per repository: durable deduplication, issue leases, audit and reconciliation. |
| `github.ts` | Short-lived GitHub App installation token and bounded GitHub API client. |
| `policy.ts` | D5620: the bundled landing-policy classifier and `policy_version`, the deployed commit injected with `wrangler deploy --define`; a build without it refuses to load. |
| `policyCheck.ts` | D5620: fail-closed `evaluate({base, head})` over the compare file list; cap, missing patch, API error, exception and timeout are T2. |
| `types.ts` | Delivery/run contracts and generated bindings plus owner-installed secrets. |
| `lib/` | Pure cancellation and fencing policies. |
