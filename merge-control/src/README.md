# Merge Control source

| File | Purpose |
| --- | --- |
| `index.ts` | Public ingress and authenticated owner routes, Queue and cron handlers. |
| `webhook.ts` | Bounded raw-body HMAC verification and owner token checks. |
| `repoControl.ts` | One object per repository: durable deduplication, issue leases, audit and reconciliation. |
| `github.ts` | Short-lived GitHub App installation token and bounded GitHub API client. |
| `types.ts` | Delivery/run contracts and generated bindings plus owner-installed secrets. |
| `lib/` | Pure cancellation and fencing policies. |
