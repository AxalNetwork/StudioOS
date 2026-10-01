# design/canvases — the 107 Claude Design canvases

The corpus the first integration pass worked from. Sorted by one question:
**is there a live route for this canvas?**

| Folder | Count | Meaning |
| --- | --- | --- |
| `integrated/` | 74 | A route is running on main. Graded `CURRENT`, `UPGRADE` or `RESKIN` — the surface exists, and for `UPGRADE`/`RESKIN` the canvas is a *diff against* something already live. |
| `backlog/` | 29 | Graded `NEW` or `DEFERRED`. No route yet. |
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

**2026-09-26 (D305), the wave-8 canvas PR, moved all three numbers that move.**
`integrated/` went **66 → 70** when four canvases graduated out of
`design/incoming/`: `Calendar` (its page shipped 2026-09-10) and
`Pages · Advisor Expertise`, `Pages · Advisor Network` and
`Pages · Advisor Research`, whose routes run on the advisor licence. None came
from `backlog/`, so `backlog/` did not move for them. `integrated/` then went
**70 → 74** when four new canvases arrived for routes that are already live —
graded `UPGRADE` on arrival, the Programme Brief precedent —
`Spin-Out Lab · Landing` (`/spinout-lab`), `Pages · Funds and fund research`
(`/research/funds`, `/funds`), `Studio · Archetype preview` (`/studio`,
`/studio/archetype`) and `Studio · Persona hubs` (the five Studio homes). And
`backlog/` went **25 → 29** when four arrived for routes that do not exist
yet: `Pages · Benchmark`, `Pages · Diligence file`, `Pages · Diligence room`
and `Pages · Company analysis`. `Refer & Earn` was replaced in place, which
moves no number (below).

**The `107` in the title is the first audit's corpus, not today's total.** It
is `54 + 26 + 27` — the sum as it stood when `integrated/` read 54. The three
folders hold `74 + 29 + 27 = 130` as of 2026-09-26, counted by listing them,
and the title keeps 107 because the paragraph below uses it for the audit it
names.

Sorting is derived from the grade in
`documentation/architecture/ROUTE_MAP.md`, which has a row for every one of the
107 — plus the later rows in its part 5 and the canvases that arrived after
the audit, **125 rows in all as of 2026-09-26**, counted by the parser
`profile_routing_fresh.test.mjs` pins. Five canvases in these folders still
carry no row: `Pages · Partner Delivery`, `· Network`, `· Offers` and
`· Research`, and `out-of-scope/Spin-Out Lab`. That gap is D305's to report and not to fill. The
ledger is the authority on *what* shipped
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

**2026-09-26 (D282).** Both files were replaced again with fresh decodes of the
same two artifacts, and again neither moved folder: **`integrated/` stays 66**.

| canvas | was | is |
| --- | --- | --- |
| `Admin · Subsidiary` | 219 KB · S0–S19 | **244 KB · S0–S23** |
| `Admin · Super` | 283 KB · H1–H34 | **315 KB · H1–H38** |

Both are strict appends — every line main held is still there, checked with
`diff` rather than assumed (five hunks on the Subsidiary, four on the Super) —
and each carries four new CHANGELOG rows. The rail both canvases mount ships
inside each bundle as an `ext_resources` entry the decoder does not write; it
was extracted, is byte-identical in the two bundles, and replaces
`backlog/AdminRail.dc.html` (10 KB → 13 KB: a scope chip, a decline card,
"Eadwyn" for "Personal Advisor", and Programs, Community, Contracts and Settings
page models). `backlog/` stays 25: a replacement moves no file. D282 lists
where the new artboards disagree with each other and with the code.

**The one asset that could not be placed has been identified, and the tag now
points at the file it is.** Until 2026-09-26 `Admin · Subsidiary` referenced
`4835ee6e-8882-4123-a5fb-fec77f0048df` as the 34px Eadwyn mark on S1,
unresolvable because the artifact's asset store answered `capability_disabled`,
and it rendered as a broken image on purpose — `scripts/read-canvas.mjs` refuses
to substitute an asset it does not recognise, and its header says why: *"a canvas
that silently drops an asset is worse than one that says which asset it could
not place."* The 2026-09-26 export inlines the image in its bundle instead, and
read out of the manifest it is `frontend/public/eadwyn-ai.png` with a C2PA
`caBX` chunk added — byte-identical once that chunk is removed, checked by
hashing both (D282). So line 132 now reads
`src="../../../frontend/public/eadwyn-ai.png"`: it resolves from `integrated/`,
it asserts exactly what the design shows, and it commits no second copy of the
image. It is the one line in either canvas that is not the decoder's output. A
future re-decode will put the uuid back and the decoder will report it; re-apply
the path rather than resolving the asset into `assets/`.

**2026-09-26 (D305).** Two re-exports, six copy corrections and five image
resolutions, all in place. None moves a number.

- `Pages · Market reading` took the ANALYTICS markup from artifact `c2cc013f`:
  the `boards` loop and its atomics block, +209/−8. Its DCLogic is unchanged,
  and its one unplaced image points at `../assets/axal-dossier-mark.png`.
- `Refer & Earn` was replaced by the copy that waited in `design/incoming/`
  (68,003 B over 56,492 B). That copy is byte-identical to a fresh decode of
  artifact `55827507` (sha256 `6d978942…`, compared rather than assumed).
  Measured as sets of quoted literals and `{{ }}` bindings, it is not a literal
  superset: about a hundred literals are added (the count moves with the
  extractor — 67, 100 and 103 across three passes) and three are removed, each
  confirmed by a direct search. Read, all three are a rename and a restyle, not
  a loss. `{{ sharePlatforms }}` (LinkedIn, X, WhatsApp, Telegram) becomes
  `{{ shareLink }}`, which draws the same four plus Facebook, beside two new
  lists (`shareQuick`, seven quick actions; `shareMedia`, three story and card
  formats). The other two are the old share modal's container styles; that
  modal now uses the 460px box the canvas's other modal already used. So
  nothing the old canvas drew is gone, which is what the strict-superset rule
  protects; D305 records the measurement.
- Six copy corrections:
  - `Use of Funds` — `exportAxal VC` and `icAxal VC` back to `exportAxal` and
    `icAxal`, a find-and-replace that had reached identifiers;
  - `Trust Center v2` — the advisor obligations, the advisor role tab and its
    envelopes, and a first-month delta that no longer reads a previous score
    that does not exist;
  - `Founder Studio` — `Personal Advisor` becomes Eadwyn;
  - `Advisor Studio` — two lines become "Eadwyn assessment";
  - `DetailRail` and `InvRail` — `AI fills the blanks`.

  `Emails` was checked and needed nothing.
- Images:
  - **The five asset uuids** left unplaced (Benchmark, Diligence file,
    Diligence room, Company analysis, Persona hubs) are each byte-identical to
    `assets/axal-dossier-mark.png` (7,770 B, sha256 `1157074b…`). So each
    points there.
  - **`Spin-Out Lab · Landing`'s hero** was a 522 KB JPEG data URI. It is a
    lossy encode of `frontend/public/axal-vc-future.png`: 51.7 dB PSNR, mean
    |d| 0.40/255, compared at 192 px. So it points at
    `../../../frontend/public/axal-vc-future.png`, and the file drops from
    744 KB to 47 KB, under the 500 KB LFS gate.
  - **The landing's other image** is an 8.9 KB mark inside an `sf.app` branch
    the landing never renders. It matches no repo file closely enough to name:
    24 dB against the dossier mark. So it stays inline rather than being
    pointed at a guess.
- `Spin-Out Lab · Landing` does not replace `Spin-Out Lab · Intro`. The landing
  draws one surface and drops the app surface the Intro carries, so it is not a
  superset, and both stay.
