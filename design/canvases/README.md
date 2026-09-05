# design/canvases — the 107 Claude Design canvases

The corpus the first integration pass worked from. Sorted by one question:
**is there a live route for this canvas?**

| Folder | Count | Meaning |
| --- | --- | --- |
| `integrated/` | 57 | A route is running on main. Graded `CURRENT`, `UPGRADE` or `RESKIN` — the surface exists, and for `UPGRADE`/`RESKIN` the canvas is a *diff against* something already live. |
| `backlog/` | 26 | Graded `NEW` or `DEFERRED`. No route yet. |
| `out-of-scope/` | 27 | Deliberately not being built. The `ROUTE_MAP.md` row says why. |
| `shared/` | 6 | The dc-runtime bundle every canvas loads, plus two standalone pitch-deck exports. Generated — both code scanners ignore this tree. |
| `assets/`, `scraps/`, `uploads/` | — | Images and stale duplicates from the export. Not part of the 107. |

The `integrated/` count read 54 until 2026-09-05 while the folder held 56 —
two canvases were filed without the number moving. It is 57 now, counted rather
than remembered, and `design/incoming/README.md` says the rule: if you move a
file, move the number.

Sorting is derived from the grade in
`documentation/architecture/ROUTE_MAP.md`, which has a row for every one of the
107 and is the authority on *what* shipped from each canvas — which zones were
built, which were not, and why. This folder only answers the coarse question of
whether a route exists at all.

## A file in `integrated/` does not mean "finished"

Most of them are `UPGRADE`: a live route exists and the canvas asks for more
than it currently does. Read the `ROUTE_MAP.md` row before assuming a canvas in
here has nothing left in it.

## Do not edit these

They are exports. Editing one makes it disagree with the design source without
changing anything that runs. If a design needs to change, it changes in Claude
Design and a new export lands in `design/incoming/`.
