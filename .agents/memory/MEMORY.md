# Memory index

- [Test & tooling quirks](test-tooling-quirks.md) — nodejs-22 required; wrangler needs Node 22+; cloudflare-worker install needs --legacy-peer-deps; node:sqlite binds ?N by occurrence; Vite 8 uses oxc.target not esbuild.target; after fresh npm install clear frontend/node_modules/.vite or lazy chunks get "Importing a module script failed" / duplicate-React errors.
- [GitHub access](github-access.md) — repo git OAuth is broken; use the GitHub connector via /tmp-installed @replit/connectors-sdk (listConnections('github') returns empty).
- [Spin-Out Lab conventions](spinout-lab-conventions.md) — /spinout-lab: marketing when logged out, full app shell when logged in; its Worker test slices exact source strings, so new /state fields go in the wire handler.
- [docs/Worker lockstep](docs-worker-lockstep.md) — /assets/* on axal.vc is Worker-served; a docs/ push without a Worker redeploy 404s the new hashes (blank page).
- [React Router redirect races](router-redirect-races.md) — guard redirects re-fire on urgent re-renders after auth/role flips; keep pending nav targets alive until the URL arrives.
- [Owner work style](owner-work-style.md) — cancels queued follow-up tasks; wants direct in-session fixes, propose sparingly.
- [Dev/Worker API parity](dev-worker-api-parity.md) — apply-method & server deck export are Worker-only (405 in dev); pages need explicit client fallbacks.
- [D1 users column limit](d1-users-column-limit.md) — never ALTER users (at the 100-column cap); per-user state goes in sidecar tables joined by user_id.
- [Deck data honesty](deck-data-honesty.md) — financial_models computed months are forecasts, never chart as traction; merged Problem/Ask slides still read validation/captable sections via prefixes.
- [Fund money-column semantics](fund-money-semantics.md) — vc_funds.total_commitment is summed LP commitments, not the target; fund size lives in fund_size_cents; lpa_signed & slug are D1-only.
- [Font LFS attribute quirk](font-lfs-attribute-quirk.md) — Space Grotesk is stored as a full blob despite *.woff2 LFS attributes; use a local .git/info override before pulling.
- [Cloudflare cutover observability](cloudflare-cutover-observability.md) — Adaptive HTTP status counts work, but edge-TTFB fields do not; combine five-minute 5xx buckets with route/API probes.
- [Production schema ownership](production-schema-ownership.md) — request-time DDL is dev/preview-only; production D1 migrations must create public-route schemas before deployment.
- [Production auth verification](production-auth-verification.md) — do not assume the workspace JWT secret can mint tokens accepted by the deployed Worker; use a real production session or prove secret parity first.
