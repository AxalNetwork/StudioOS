# Memory index

- [Test & tooling quirks](test-tooling-quirks.md) — test:drift needs Node 22 (nix path), cloudflare-worker install needs --legacy-peer-deps, node:sqlite binds ?N by occurrence not number.
- [GitHub access](github-access.md) — repo git OAuth is broken; use the GitHub connector via /tmp-installed @replit/connectors-sdk (listConnections('github') returns empty).
- [Spin-Out Lab conventions](spinout-lab-conventions.md) — /spinout-lab: marketing when logged out, full app shell when logged in; its Worker test slices exact source strings, so new /state fields go in the wire handler.
- [docs/Worker lockstep](docs-worker-lockstep.md) — /assets/* on axal.vc is Worker-served; a docs/ push without a Worker redeploy 404s the new hashes (blank page).
- [React Router redirect races](router-redirect-races.md) — guard redirects re-fire on urgent re-renders after auth/role flips; keep pending nav targets alive until the URL arrives.
- [Owner work style](owner-work-style.md) — cancels queued follow-up tasks; wants direct in-session fixes, propose sparingly.
- [Dev/Worker API parity](dev-worker-api-parity.md) — apply-method & server deck export are Worker-only (405 in dev); pages need explicit client fallbacks.
- [D1 users column limit](d1-users-column-limit.md) — never ALTER users (at the 100-column cap); per-user state goes in sidecar tables joined by user_id.
