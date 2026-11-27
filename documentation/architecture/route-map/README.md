# route-map/ — the route map, one fragment per section and per canvas (D4102)

The canvas → route → backend map, with each canvas's implementation status. It
used to be one file, `../ROUTE_MAP.md`; that file is now only a pointer here.

## What is here

| Folder | What it holds |
| --- | --- |
| `sections/` | The map's prose and tables, one file per section, read in file-name order. The first file (number 0000) is the top of the map. |
| `canvases/` | One folder per canvas table: `part-1/`, `part-2/`, `part-3/`, `part-4/` and `part-5/`. Each holds one file per canvas, and each file is one table row, followed by its list when it has one (rule 4). |
| `sections/0999-grow-campaign-store-d4447.md` | #4447 / #3722 Part A: Grow campaign store routes; no UI. |

A section that holds a canvas table keeps the table's header and separator, then
one marker line, `<!-- route-map rows: canvases/part-N -->`. The rows of that
folder are placed there, in file-name order.

## The rules

1. **One row per canvas, in its own file.** Adding a canvas is adding a file;
   changing one is editing only its file. Never write canvas rows inline in a
   section.
2. **Names are `NNNN-<lowercase-slug>.md`.** The number sets the order. Pick one
   between the neighbours where the entry reads best: they step by 10, so there
   is room. Two branches that pick the same number with different slugs do not
   conflict; the slug breaks the tie.
3. **Edit only your own fragment.** No branch needs to touch a file another
   feature owns.
4. **A list cell is one item per line, sorted (D6471).** When the "Backend it
   wires to" cell is a pure list (backticked names joined by `, `, each with at
   most one `(note)` after it), the row holds `{backend}` in its place, and the
   items follow after a blank line and a `backend:` line, one `- ` line each:

   ```
   | Accounts | founder | `/accounts` | same | {backend} | CURRENT | Notes … |

   backend:
   - `accounts.ts` (the overview)
   - `users.ts`
   ```

   The map reads the cell as the items joined by `, `. To add a file, add its
   line where it sorts (by character code, so `_` sorts before a lowercase letter).
   On a merge conflict inside a list, keep both lines in order. Any other cell,
   including a backend cell that is prose or `;`-groups, stays in the row as
   written. `node scripts/convert-route-map-lists.mjs` converts a file written
   the old way.
5. **Check before pushing:** `node scripts/build-route-map.mjs --check`. It fails
   on a canvas with two rows (naming both files), on a canvas file that is not
   one row and its list, on rows written inline, on a rows folder no section
   places, and, naming the file, line and item, on a list item that is
   duplicated or out of order or a list cell still written in the row.
6. **Read it whole:** `node scripts/build-route-map.mjs` writes the combined map
   beside these folders. It is gitignored: never commit it, never edit it.

Code reads the map only through `scripts/lib/routeMap.mjs`. Its `readRouteMap()`
returns the whole map as one text, exactly as the single file read before the
split.

D2319: an address followed by `(retired D2319)` is historical only. Any old
forwarding or counted-redirect description for that marked address predates its
retirement; it no longer mounts or forwards. The frontend guard scans every
fragment for unmarked retired SPA addresses. Worker endpoint columns have their
own `/api` mount and are checked separately from SPA navigation.
