# ROUTE_MAP — canvas → route → backend, with implementation status

**The map lives in [`route-map/`](route-map/README.md), one file per section and
one file per canvas row (D1615, #4102).** This page only says where it is. Do
not add rows or notes here: no branch needs to edit this file, so it never
conflicts.

- **Add a canvas:** add one file under `route-map/canvases/part-N/`, holding its
  one table row.
- **Change a canvas:** edit its own file.
- **Add a section:** add `route-map/sections/NNNN-<slug>.md`, numbered to land
  where it reads best.
- **Read it as one document:** `node scripts/build-route-map.mjs` writes the
  combined map beside the fragments. That file is not committed.
- **Check it:** `node scripts/build-route-map.mjs --check` (part of
  `npm run test:guards`) fails on a canvas with two rows and names both files.

Every script and test reads the map through `scripts/lib/routeMap.mjs`, which
returns exactly the text this file held before the split. `PROFILE_ROUTING.md`
and `PAGE_INVENTORY.md` are still generated from it by
`node scripts/build-profile-routing.mjs`.

**Why.** ROUTE_MAP.md was touched by 226 of 403 commits in the week to
2026-11-02, by far the most-edited file in the repository. Its `merge=union`
kept both versions of any row two branches changed, which failed every PR on
main until someone deleted one (#4044, #4098).
