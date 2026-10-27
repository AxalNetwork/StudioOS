# Vercel REST reads

`api.ts` is the only caller of `api.vercel.com` (D1096, #2961). It exports
`vercelClient(auth)` with one typed method for each planned read, plus uninstall,
and the OAuth code exchange. Requests use the token's team, reject redirects,
limit bodies and time, and expose static error codes and rate-limit headers.
No deployment, cancellation, rollback, environment variable or domain write exists.
Logs, runtime logs and Web Analytics wrappers are reserved, never called by the
part 1 sync. Analytics remains off. Provider tests replace fetch with
`test/_vercel_api_fake.mjs`; no test reaches Vercel.

D1096 completes part 1 around it: `integrations/providers/vercel.ts` is its only caller in the connection, sync and Choose projects, and `routes/vercel_webhook.ts` re-reads through the same provider when a delivery nudges it. The part 1 sync calls the installation, projects and project-domains reads only.

`health.ts` (D1097, #2962) holds production health: `healthFindings` turns
evidence read from the API into the events it opens (a failed production
deploy, a rollback, a misconfigured or unverified domain, a failed
certificate, a Vercel-registered domain inside its expiry window) and the
kinds it could check; `applyHealth` opens and closes `vercel_health_events`
(migration 590) with their ledger rows; `dismissHealthEvent` keeps a
dismissal. `hosting.ts` is Operating systems › Tools' Hosting read under the
Tools rule.
