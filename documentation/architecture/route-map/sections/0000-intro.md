# ROUTE_MAP.md — canvas → route → backend, with implementation status

D1156 (#3061): HQ Super Admin reads dated studio aggregates at
`GET /api/admin/program-grants/licences/:uid/in-use`; a local branch Admin
requests its own report with `POST /api/licence/mine/programs/report`. The
authenticated `reportProgramUsage` RPC and daily 05:15 UTC branch job share
`services/programUsage.ts`. No new page layout is introduced.

Produced by the P−1 audit (§16 step 2). Every "Live route today" cell was read
from `frontend/src/App.jsx` with its guard; every backend cell names a file that
exists under `cloudflare-worker/src/routes/`. CURRENT vs UPGRADE calls come from
reading the live page component side by side with the canvas, not from name
matching. Comparisons are source-level; the app was not run.

**Corpus:** 107 canonical `*.dc.html` canvases at `design/canvases/` (top level
only), as counted by the P−1 audit. Canvases that have landed in
`design/incoming/` since are NOT in that 107; part 5 below holds the rows for
the ones that have graduated out of the queue. `uploads/` holds 3 stale duplicates and `scraps/` holds images — both
excluded. Also outside the 107, in `canvases/shared/`: 2 standalone pitch-deck
HTMLs and 4 shared JS modules (`support.js`, `doc-page.js`, `deck-stage.js`,
`fund-model.js`) — every canvas references the runtime as a relative
`support.js` rather than inlining it — plus `assets/`. (This sentence said "at
the root" until 2026-09-07; the root of `design/canvases/` holds only its
`README.md`.)

**Link previews are a separate map.** Which social card each route shares as —
access, whether it is meant to be shared, the card key and where its title and
image come from — is `SOCIAL_CARDS_MAP.md` (D1440, #3915), with the retirement
calls for `/compliance` (retired D2319), `/account/companies*`, `/product-testing`, `/lp/*` and
`/comarketing` in `decisions/D1440.md`.
The Worker answers the record prefixes (D1439) and, since #3916, the token
share links `/esign/*`, `/deck/share/*`, `/share/*`, `/invite/*` and `/join/*`
before the SPA shell: those get the static "Sign in to view" card, `noindex`,
and no D1 call (D1439 Part D).
D1564 (#3811) adds `/embed/:token` to both `run_worker_first` lists: the
Worker answers it only to a frame from an origin the founder listed on a
published link (`frame-ancestors` with those origins, no `X-Frame-Options`)
and refuses everything else with frames denied; the SPA draws the card view
there (`DeckEmbedPage.jsx`). A published link's own card on `/deck/share/*`
and `/share/deck/*` (`serveDeckShareCard`) is off while public views are off
(owner decision T), so those keep the static card.

