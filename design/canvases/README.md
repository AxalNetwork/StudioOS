# design/canvases — the 107 Claude Design canvases

The corpus the first integration pass worked from. Sorted by one question:
**is there a live route for this canvas?**

| Folder | Count | Meaning |
| --- | --- | --- |
| `integrated/` | 61 | A route is running on main. Graded `CURRENT`, `UPGRADE` or `RESKIN` — the surface exists, and for `UPGRADE`/`RESKIN` the canvas is a *diff against* something already live. |
| `backlog/` | 26 | Graded `NEW` or `DEFERRED`. No route yet. |
| `out-of-scope/` | 27 | Deliberately not being built. The `ROUTE_MAP.md` row says why. |
| `shared/` | 6 | The dc-runtime bundle every canvas loads, plus two standalone pitch-deck exports. Generated — both code scanners ignore this tree. Every canvas asks for it as `src="./support.js"`, which resolves next to the canvas and **not** to this folder, so opening one straight from `integrated/` in a browser gets a blank page: copy `shared/support.js` beside it first. Nothing runs these at runtime, so the reference is nominal — it is a convention marking "the shared runtime, not an inlined 69KB copy", and `scripts/read-canvas.mjs` reproduces it when it decodes a new export. |
| `assets/`, `scraps/`, `uploads/` | — | Images and stale duplicates from the export. Not part of the 107. |

The `integrated/` count read 54 until 2026-09-05 while the folder held 56 —
two canvases were filed without the number moving. It is 61 now, counted rather
than remembered, and `design/incoming/README.md` says the rule: if you move a
file, move the number. It went 57 → 59 on 2026-09-07 when
`Pages · Founder Validate` and `Navigation Shell · Anatomy` graduated out of
the intake queue, and 59 → 61 on 2026-09-12 when `Pages · Partner Network` and
`Pages · Partner Research` graduated the same way (#155).

**The `107` below is stale and this pass did not fix it**, which is worth saying
rather than leaving to be rediscovered. It is `54 + 26 + 27` — the sum as it
stood when `integrated/` read 54 — so it has drifted every time that count moved
and is now `61 + 26 + 27 = 114`. Correcting the number here would assert that
`ROUTE_MAP.md` carries 114 rows, and that was not counted; the sentence below is
the one making the claim, so the count belongs in the same pass that reads it.

Sorting is derived from the grade in
`documentation/architecture/ROUTE_MAP.md`, which has a row for every one of the
107 — plus 2 more in its part 5 for the canvases that have since graduated out
of `design/incoming/`, 109 rows in all — and is the authority on *what* shipped
from each canvas — which zones were
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
