# `frontend/src/pages/studio/` — Studio modularity (D1419, #3698)

The module half of every `/studio`: the grid each of the four Studio homes
(`../founder/FounderStudioBody.jsx`, `../investor/InvestorStudioHome.jsx`,
`../advisor/AdvisorStudioHome.jsx`, `../partner/PartnerStudioHome.jsx`) draws
below its fixed blocks (Eadwyn's chat, the founder strip, the profile card),
drawn to `design/incoming/Studio Modularity Page.dc.html` and
`design/incoming/Studio Modularity · Boards.dc.html` (SM0–SM15). The board →
file map and the owner's answers are in
`documentation/architecture/decisions/D1419.md`.

| File | What it is |
| --- | --- |
| `studioLayoutModel.js` | The pure rules: sizes and spans, move / add / remove / resize, the cap of 12, Recommended, search, dropped lines, how a refusal is read, the cycle module keys. |
| `studioFallback.js` | The Worker's defaults and titles, for a layout read that failed (SM8a) only. A test holds it equal to `cloudflare-worker/src/services/studioModules.ts`. |
| `useStudioLayout.js` | The two reads, edit mode and the one save (`deriveStudio` is its pure half; `studioFromReads` draws a home from fixed reads in a test). |
| `StudioModules.jsx` | What a home mounts: the notices, "Your modules", the grid or the empty box, the edit bar, the module map, the locked sheet, the reset confirm. |
| `StudioModuleGrid.jsx` | The placed modules in order and size; drag, keyboard and press-and-hold moves. |
| `StudioModuleTile.jsx` | One module's frame and its states (SM7), and the edit chrome. |
| `ModuleMapLightbox.jsx` | The module map (SM6). |
| `StudioParts.jsx` | The fixed lock, Customise, the notices (SM8), SM12a, the locked sheet (SM12b), the edit bar and the reset confirm (SM5). |
| `studioProposalsAdapter.js` | The seam for Eadwyn's layout proposals (SM9, SM10), unavailable until #3864. |
| `studioModules.css` | The canvas's light and dark tokens and the grid. |
| `tiles/` | One builder per profile: each module's body and state over the reads its home already makes. The advisor's specs are built in its home. |

## The rule for adding here

- **The layout is the Worker's.** Read and write it only through
  `studioLayoutApi` (`../../lib/api/studioLayout.js`, D1421, D1594). Add no
  client method from here, and never name an `/api` path in this folder.
- **Done is the only save.** An edit changes the local draft; nothing saves
  per move. A failed save keeps the draft and says why.
- **A module is a key the Worker's catalogue offers** (`GET /api/studio/modules`,
  D1418). A new module lands in the Worker registry first; its body
  then goes in its profile's `tiles/` builder, over a read the home already
  makes. A tile never makes a read of its own, except the founder's cycle
  modules (one `cyclesApi.overview` per cycle with a placed module).
- **"Not recorded" is never a 0,** and a failed read is "<Title> could not be
  read · Try again", alone (`TileBody`).
- **No AIRail and no Ask on /studio,** and never "Fill". Eadwyn's proposals
  arrive in the chat once #3864 lands; replace only `propose`'s one-line body.
- **People by name, never by email.**
