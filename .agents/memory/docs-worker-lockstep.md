---
name: docs/ + Worker deploy lockstep
description: Why a docs/ (GitHub Pages) rebuild must always ship with a Cloudflare Worker redeploy, and how to verify.
---

**Rule:** Never push a rebuilt `docs/` to remote main without also running `npm run deploy` in `cloudflare-worker/` (Node 22 nix PATH + `CLOUDFLARE_API_TOKEN`).

**Why:** On prod (axal.vc) the root HTML is served by GitHub Pages from `docs/`, but the hashed `/assets/*` files are served by the Worker's assets binding from ITS deployed bundle. A docs-only push makes the HTML reference new hashes the Worker doesn't have → asset 404s → blank page (the recurring Safari incident). The scheduled "post-deploy SPA smoke" GitHub Action catches this within 6h.

**How to apply:** After any frontend build that changes `docs/`, deploy the Worker in the same shipping step, then verify: `curl -s https://axal.vc/ | grep -o 'assets/index-[^"]*\.js'` and curl that exact asset path expecting 200. Can also `workflow_dispatch` post-deploy-smoke.yml via the GitHub connector to confirm green.
