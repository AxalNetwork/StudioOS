# Cloudflare Pages migration — the frontend moves, the Worker keeps the API

**Decision, 2026-08-31.** The frontend moves from Workers Static Assets to
**Cloudflare Pages**. The existing Worker keeps serving `axal.vc/api/*` — all
151 route files, D1 bindings, auth and cron stay exactly where they are. That
split was chosen explicitly; the alternative (porting the API to Pages
Functions) was considered and declined.

**This supersedes fact 4 in `CLAUDE.md`**, which says the frontend is served by
the Worker's `[assets]` binding, "Workers Static Assets, **not** Cloudflare
Pages. There is no Pages project in this repo." That statement is still true
*today* and stays true until the steps below are executed. It is deliberately
not being rewritten in advance — the whole reason that file exists is that a
previous architecture flip was declared in docs before it was real, and never
finished. `CLAUDE.md` gets updated when the Pages project actually serves
traffic, not before.

---

## The two efforts converge; they are not two migrations

`CLOUDFLARE-CUTOVER.md` is already most of the way through evicting GitHub
Pages from the apex. It is easy to read that as one migration and this as a
second. It is not:

| | Original cutover target | Revised target |
| --- | --- | --- |
| Who serves `axal.vc/*` HTML | The Worker's `[assets]` binding | **Cloudflare Pages** |
| Who serves `axal.vc/api/*` | The Worker | The Worker (unchanged) |
| GitHub Pages | Decommissioned | Decommissioned (unchanged) |

Steps 1–5 of that document are unaffected and still required — the OAuth
redirect URIs, the observation gate, the `OAUTH_CALLBACK_BASE_URL` flip. **Only
step 6's destination changes**: the apex DNS points at the Pages project rather
than at "GitHub Pages, removed." Step 7 (retrying the `axal.vc/*` wildcard
Worker route) becomes moot and should be struck once this lands — with Pages
serving the frontend, the Worker's route table wants to claim *less*, not more.

Finish that cutover first. Adopting Pages does not get the apex off Jekyll any
sooner, and stacking two DNS-level changes on the same window during an open
5xx investigation multiplies the blast radius for no gain.

---

## What was already here, and was not what it looked like

Two files sat at the repo root: `cloudflare.toml` and `github.toml`. Three
documents (`GOTCHAS.md`, a June audit, the changelog) described them as live
configuration enforcing security headers on the public marketing surface. They
were not.

- Both are written in **Netlify's TOML dialect** — `[[headers]]`,
  `[[redirects]]`, `[context.production]`, `[build.processing]`. Cloudflare
  Pages does not read a file called `cloudflare.toml`; it reads `_headers` and
  `_redirects`. GitHub Pages does not read `github.toml` at all.
- **Nothing in the repository referenced either one** outside prose — no
  workflow, no script, no build step. Verified by grep across every `.yml`,
  `.yaml`, `.mjs` and `.js`.
- Both were added in a single commit whose message is about something else
  entirely: `5d2705e8` — "Add pasted advisor workspace sections reference
  document."
- `cloudflare.toml`'s HSTS had drifted to `max-age=31536000`, half the
  Worker's live `63072000`.

So the public frontend has been serving with **no repo-enforced security
headers at all**, while three documents said otherwise. Both files are deleted.
`frontend/public/_headers` replaces them in the format Pages actually reads,
with values taken from the Worker's live middleware rather than from the dead
file.

---

## What Pages does not inherit for free

Two behaviours are Worker-specific and had to be rebuilt, not assumed:

1. **Stale hashed assets must 404, not fall back to `index.html`.** The Worker
   does this in code (Task #37 in `index.ts`): it fetches from the ASSETS
   binding and converts a `text/html` response for an `/assets/*` path into a
   real 404, because otherwise the browser executes HTML as a JS module and the
   page renders blank — the recurring Safari blank page after a deploy. Pages
   consults `_redirects` only when no real file matches, so a lone catch-all
   `/* /index.html 200` would reintroduce exactly that bug. `_redirects`
   therefore puts `/assets/* /404.html 404` **above** the catch-all. Pages
   stops at the first match, so ordering is load-bearing.
2. **SPA fallback is a different mechanism.** The Worker uses
   `not_found_handling = "single-page-application"` in `wrangler.toml`; Pages
   uses the `/* /index.html 200` rule. Same intent, different file. The 31
   prerendered routes in `docs/` are real files either way and never reach the
   fallback.

**Content-Security-Policy is deliberately absent** from `_headers`. The
Worker's CSP is nonce-based and generated per request, which a static file
cannot reproduce, and `index.html` carries inline bootstrap script (the boot
watchdog), so a naive `script-src 'self'` would white-screen every visitor.
There is no CSP on the frontend today either — the file that claimed to set one
was never read — so shipping without one is not a regression. Adding a correct
static CSP requires enumerating and hashing the inline scripts against a real
deployed preview.

---

## Order of operations

1. **Finish `CLOUDFLARE-CUTOVER.md` steps 2–5** — OAuth URIs registered, the
   24-hour gate confirmed clean, `OAUTH_CALLBACK_BASE_URL` flipped and Google
   sign-in verified. Unchanged by this document.
2. **Create the Pages project** pointed at this repo, build output `docs/`.
   Connect it to its default `*.pages.dev` hostname only — **do not bind
   `axal.vc` yet**. Console/API action; not possible from the build
   environment.
3. **Verify at `*.pages.dev`**, and know what that can and cannot prove:
   - *Can* prove: the SPA loads, prerendered routes serve directly, client-side
     routes fall back to `index.html`, and a request for a made-up
     `/assets/nope.js` returns **404**, not HTML with a 200.
   - *Cannot* prove: live API integration. Production CORS is a fixed
     allowlist (`app.axal.vc`, `axal.vc`, `www.axal.vc`, `status.axal.vc`) and
     `EXTRA_DEV_ORIGINS` is documented as empty in production, so a
     `*.pages.dev` origin is refused **by design**. Same-origin API calls only
     start working when the custom domain binds, which is the commit step. That
     residual risk cannot be pre-verified; do not claim otherwise.
4. **Bind `axal.vc` to the Pages project** and move apex DNS. This *is*
   `CLOUDFLARE-CUTOVER.md` step 6, not a separate action.
5. **Confirm Worker route precedence.** The Worker must keep winning
   `axal.vc/api/*` against the Pages project on the same hostname, and should
   stop claiming `/assets/*` once Pages owns the frontend bundle
   (`run_worker_first` currently lists `/api/*`, `/landing/*`, `/p/*`,
   `/assets/*`). Verify with real requests before declaring the cutover done.
6. **Then update `CLAUDE.md` fact 4** and strike `CLOUDFLARE-CUTOVER.md` step 7.

## What could not be done from the build environment

`axal.vc` and the Cloudflare API are blocked by this environment's egress
policy — 403 on CONNECT, which the proxy README classifies as an organization
policy denial and instructs not to route around. Steps 2–5 are operator
actions. Everything in the repository — `_headers`, `_redirects`, the dead-file
removal — is done.
