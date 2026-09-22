# design/canvases — the 107 Claude Design canvases

The corpus the first integration pass worked from. Sorted by one question:
**is there a live route for this canvas?**

| Folder | Count | Meaning |
| --- | --- | --- |
| `integrated/` | 66 | A route is running on main. Graded `CURRENT`, `UPGRADE` or `RESKIN` — the surface exists, and for `UPGRADE`/`RESKIN` the canvas is a *diff against* something already live. |
| `backlog/` | 25 | Graded `NEW` or `DEFERRED`. No route yet. |
| `out-of-scope/` | 27 | Deliberately not being built. The `ROUTE_MAP.md` row says why. |
| `shared/` | 6 | The dc-runtime bundle every canvas loads, plus two standalone pitch-deck exports. Generated — both code scanners ignore this tree. Every canvas asks for it as `src="./support.js"`, which resolves next to the canvas and **not** to this folder, so opening one straight from `integrated/` in a browser gets a blank page: copy `shared/support.js` beside it first. Nothing runs these at runtime, so the reference is nominal — it is a convention marking "the shared runtime, not an inlined 69KB copy", and `scripts/read-canvas.mjs` reproduces it when it decodes a new export. |
| `assets/`, `scraps/`, `uploads/` | — | Images and stale duplicates from the export. Not part of the 107. |

The `integrated/` count read 54 until 2026-09-05 while the folder held 56 —
two canvases were filed without the number moving. It is 61 now, counted rather
than remembered, and `design/incoming/README.md` says the rule: if you move a
file, move the number. It went 57 → 59 on 2026-09-07 when
`Pages · Founder Validate` and `Navigation Shell · Anatomy` graduated out of
the intake queue, and 59 → 61 on 2026-09-12 when `Pages · Partner Network` and
`Pages · Partner Research` graduated the same way (#155), and **61 → 62 on
2026-09-15** when `Admin · Subsidiary` graduated because PR 5 gave it its eight
routes (D107) — `backlog/` moved 26 → 25 in the same commit, which is the whole
of the rule: a file that moves takes its number with it. It went **62 → 63 on
2026-09-16** when `Spin-Out Lab · Programme Brief` arrived (D123). That one did
not move between folders, so `backlog/` did not change: it is a genuinely new
canvas for a route that was already live (`/spinout-lab/brief`), which makes it
an `UPGRADE` on arrival rather than a graduation. It went **63 → 64 on
2026-09-21** when `Pages · Fund dossier` arrived for `/research/funds/:uid`.
`backlog/` did not change: the list was already live, and this canvas is the
reading room for one row. It went **64 → 65 on 2026-09-21** when
`Pages · Company` arrived for `/research/companies/:analysisId/:candidateId`.
`backlog/` did not change: the companies list was already live, and this
canvas is one competitor inside an analysis. It went **65 → 66 on 2026-09-21**
when `Pages · Market reading` arrived for `/research/markets/:uid`.
`backlog/` did not change: the markets list was already live, and this canvas
is one reading.

**The `107` below is stale and this pass did not fix it**, which is worth saying
rather than leaving to be rediscovered. It is `54 + 26 + 27` — the sum as it
stood when `integrated/` read 54 — so it has drifted every time that count moved
and is now `66 + 25 + 27 = 118`. Correcting the number here would assert that
`ROUTE_MAP.md` carries 115 rows, and that was not counted; the sentence below is
the one making the claim, so the count belongs in the same pass that reads it.

Sorting is derived from the grade in
`documentation/architecture/ROUTE_MAP.md`, which has a row for every one of the
107 — plus the later rows in its part 5 and the canvases that arrived after
the audit, 113 rows in all — and is the authority on *what* shipped
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

## Amendments in place — a re-export replaces content, and moves no number

**2026-09-22 (D195).** `Admin · Subsidiary.dc.html` and `Admin · Super.dc.html`
were both replaced with fresh decodes of the artifacts they came from. Neither
file moved folder, so **`integrated/` stays 66** — the "if you move a file, move
the number" rule above governs *moves*, and a re-export is a content change. The
count is stated here rather than left to be checked, because the last four times
this file changed it was a move and the reader learns to look for one.

| canvas | was | is |
| --- | --- | --- |
| `Admin · Subsidiary` | 110 KB · S0–S13 | **219 KB · S0–S19 plus S1b, S1c, S1d** |
| `Admin · Super` | 135 KB · H1–H13 | **283 KB · H1–H34** |

Both new exports are strict supersets — every artboard id the repo already
carried is still present, which is checked rather than assumed — so nothing was
lost by replacing them. Each carries its own CHANGELOG artboard listing the
in-place amendments to the ids that already existed; that block, not this table,
is the authority on what changed inside an artboard.

**One asset could not be placed, and it stays an unresolved uuid on purpose.**
`Admin · Subsidiary` references `4835ee6e-8882-4123-a5fb-fec77f0048df` as the
34px Eadwyn mark on S1. `scripts/read-canvas.mjs` refuses to substitute an asset
it does not recognise, and its header says why: *"a canvas that silently drops an
asset is worse than one that says which asset it could not place."* The asset
store was unreachable from here — the published artifact does not declare the
`assets` capability, so a read of it answers `capability_disabled` — and pointing
the tag at a different mark in `assets/` would make the canvas assert something
the design does not show. So it renders as a broken 34px image, which is the
decoder's contract working, and is the honest state until the artifact is
republished with assets declared.
