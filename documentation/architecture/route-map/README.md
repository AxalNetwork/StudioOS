# route-map/ — the route map, one fragment per section and per canvas (D4102)

The canvas → route → backend map, with each canvas's implementation status. It
used to be one file, `../ROUTE_MAP.md`; that file is now only a pointer here.

## What is here

| Folder | What it holds |
| --- | --- |
| `sections/` | The map's prose and tables, one file per section, read in file-name order. The first file (number 0000) is the top of the map. |
| `canvases/` | One folder per canvas table: `part-1/`, `part-2/`, `part-3/`, `part-4/` and `part-5/`. Each holds one file per canvas, and each file is exactly one table row. |

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
4. **Check before pushing:** `node scripts/build-route-map.mjs --check`. It fails
   on a canvas with two rows (naming both files), on a canvas file that is not
   exactly one row, on rows written inline, and on a rows folder no section
   places.
5. **Read it whole:** `node scripts/build-route-map.mjs` writes the combined map
   beside these folders. It is gitignored: never commit it, never edit it.

Code reads the map only through `scripts/lib/routeMap.mjs`. Its `readRouteMap()`
returns the whole map as one text, exactly as the single file read before the
split.
