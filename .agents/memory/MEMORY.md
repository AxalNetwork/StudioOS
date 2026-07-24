# Memory index

- [Test & tooling quirks](test-tooling-quirks.md) — test:drift needs Node 22 (nix path), cloudflare-worker install needs --legacy-peer-deps, node:sqlite binds ?N by occurrence not number.
- [GitHub access](github-access.md) — repo git OAuth is broken; use the GitHub connector via /tmp-installed @replit/connectors-sdk (listConnections('github') returns empty).
- [docs/Worker lockstep](docs-worker-lockstep.md) — /assets/* on axal.vc is Worker-served; a docs/ push without a Worker redeploy 404s the new hashes (blank page).
