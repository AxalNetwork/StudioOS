# design — sources, tokens, and the integration queue

Nothing here is built, bundled or served. It is the material the product is
made *from*, plus the record of what was made from it.

| Folder | What lives there |
| --- | --- |
| `incoming/` | **Drop new Claude Design exports here.** The intake queue — start with its README. |
| `canvases/` | The 107 canvases from the first integration pass, sorted by whether a live route exists. |
| `tokens/` | `tokens.json` — the token census, extracted from the canvases. |

| File | What it is |
| --- | --- |
| `token-census.md` | How the design tokens were derived, and from which canvas. |
| `pattern-census.md` | Repeated UI patterns across the corpus, and the `frontend/src/ui/` consolidation they justified. |
| `EVENT_SYSTEM.md` | Event-surface design notes. |
| `GAMIFIED_ASSESSMENT_SYSTEM.md` | Assessment design notes. |
| `PROFILING_REDESIGN.md` | Profiling design notes. |

## The flow

```
design/incoming/          a new export lands
      ↓ triage            grade it, add a ROUTE_MAP row
design/canvases/backlog/  triaged, not built yet
      ↓ build             worker route first, then the page
design/canvases/integrated/   a route is live for it
```

`documentation/architecture/ROUTE_MAP.md` is the authority on *what* shipped
from each canvas and what deliberately did not. This folder answers the coarser
question — is there a route for it at all — by where the file sits.

## Two things to know before building from a canvas

1. **A canvas is a proposal, not a specification.** It is drawn with plausible
   sample content. If the platform does not store the fact behind a figure on
   screen, the surface says so; it does not render the sample.
2. **The token set is already extracted.** Use `frontend/src/ui/` primitives and
   the Tailwind theme rather than re-deriving colours and spacing per canvas.
