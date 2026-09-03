# Cloudflare Pages migration — the frontend moves, the Worker keeps the API

> **SUPERSEDED 2026-09-03.** The architecture this document delivered lasted
> one day. On 2026-09-01 `1d320dda9` ("Remove stale documentation asset
> files", author Replit Agent — a commit whose message does not mention
> routing) replaced the three apex path routes below with a whole-host
> `axal.vc` Workers Custom Domain in both `wrangler.toml` tables, so the
> `studioos` Worker has served **both** `axal.vc` and `app.axal.vc` from its
> own `[assets]` copy of `docs/` since then — the *original* cutover target in
> the table below, not the revised one. The Pages project
> (`studioos-2p8.pages.dev`) still exists and receives a Direct Upload of a
> fresh `docs/` build on every push to `main`
> (`.github/workflows/cloudflare-pages-deploy.yml`, `eda67173d`, 2026-09-02),
> but it serves no production hostname: it is a mirror, and whether to retire
> it is `UNRESOLVED_ITEMS.md` U9. The `_headers`/`_redirects` files described
> below were themselves replaced the same day they landed by
> `frontend/public/_worker.js` (Pages Advanced Mode, `d69ff32e3`), which
> governs only that mirror. Current truth: `CLAUDE.md` fact 4 and
> `PRODUCTION.md`. The record of what bit on 2026-08-31 stays below because
> the failure mode is still the reason no path-scoped apex route may exist.

**DONE, 2026-08-31.** The frontend moved from Workers Static Assets to
**Cloudflare Pages**, and the apex now serves from it. This document is kept as
the record of how, and of the two things that bit on the way. The existing Worker keeps serving `axal.vc/api/*` — all
151 route files, D1 bindings, auth and cron stay exactly where they are. That
split was chosen explicitly; the alternative (porting the API to Pages
Functions) was considered and declined.

**`CLAUDE.md` fact 4 has been rewritten** to describe the Pages architecture,
which was the deal: it was annotated but left factually intact while the old
statement was still true, and rewritten only once Pages actually served
traffic. The Pages project is `studioos-2p8.pages.dev`, bound to `axal.vc`.
*(Superseded 2026-09-01: that binding lasted a day. The project is no longer
bound to any production hostname — see the banner above — and fact 4 was
rewritten again on 2026-09-03, after describing Pages as the apex for two days
in which the toml, the guard tests and the deploy log all said otherwise.)*

## What bit, after the domain was bound

Two failures, both worth keeping because both were predictable and one was
predicted:

1. **Pages HTML + Worker assets = blank page.** The apex was bound to Pages
   while the Worker's route table still claimed 165 patterns including
   `axal.vc/assets/*`. Worker routes beat a Pages custom domain, so Pages
   served `index.html` referencing hashes only the Pages build had, `/assets/*`
   went to the Worker's older `docs/`, the entry module 404'd, and the inline
   boot watchdog spun on `?__reboot=`. Fixed by shrinking both route tables to
   the audited four patterns. **This is the failure mode the guards now exist
   to prevent** — see `apex_cutover_bootstrap.test.mjs` (exact allowlist) and
   `apex_route_coverage.test.mjs`.
2. **Rocket Loader rewrote the Vite module script.** Cloudflare's Rocket Loader
   mangles `type="module"` on the entry tag, which can stop React booting.
   Disabled for the zone, with `data-cfasync="false"` added at build time as
   defence in depth.

---

## The two efforts converge; they are not two migrations

`CLOUDFLARE-CUTOVER.md` is already most of the way through evicting GitHub
Pages from the apex. It is easy to read that as one migration and this as a
second. It is not:

| | Original cutover target | Revised target (2026-08-31) | Since 2026-09-01 (`1d320dda9`) |
| --- | --- | --- | --- |
| Who serves `axal.vc/*` HTML | The Worker's `[assets]` binding | **Cloudflare Pages** | **The Worker's `[assets]` binding** — the original target after all, as a whole-host custom domain |
| Who serves `axal.vc/api/*` | The Worker | The Worker (unchanged) | The Worker (unchanged) |
| GitHub Pages | Decommissioned | Decommissioned (unchanged) | Decommissioned (unchanged) |

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

## Order of operations (executed)

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
