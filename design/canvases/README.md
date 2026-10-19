# design/canvases — the 107 Claude Design canvases

The corpus the first integration pass worked from. Sorted by one question:
**is there a live route for this canvas?**

| Folder | Count | Meaning |
| --- | --- | --- |
| `integrated/` | 98 | A route is running on main. Graded `CURRENT`, `UPGRADE` or `RESKIN` — the surface exists, and for `UPGRADE`/`RESKIN` the canvas is a *diff against* something already live. |
| `backlog/` | 28 | Graded `NEW` or `DEFERRED`. No route yet. |
| `out-of-scope/` | 26 | Deliberately not being built. The `ROUTE_MAP.md` row says why. |
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

**2026-10-05 (D565), one canvas moved between folders.** The owner brought
the Advisor Program into scope on #975, so `Advisor Studio` moved from
`out-of-scope/` to `backlog/`: `backlog/` went **29 → 30** and `out-of-scope/`
went **27 → 26**. `integrated/` did not move, because no route exists for it
yet. `ROUTE_MAP.md` row 46 now grades it `NEW`.

**2026-10-06 (D593), one canvas graduated.** `Pages · Company analysis` moved
from `backlog/` to `integrated/`: `integrated/` went **74 → 75** and
`backlog/` went **30 → 29**. Its route, `/research/companies/:id`, has run
since D313 built it on 2026-09-26, so it had been in the wrong folder for ten
days. The same day the owner re-exported it as "Pages · Founder Research
Analysis", and re-exported `Pages · Fund dossier` and `Pages · Market reading`
as "Pages · Founder Research Fund" and "Pages · Research Market Reading". Each
export repeats its committed canvas and adds one note board (F0, M0, C0) with
imports of the Research Page canvas (D546). The new boards were added to the
committed files, which keep their names and their processed logo path, so no
number moved for those two.

**2026-10-06 (D564), one canvas graduated.** `Founder Studio` moved from
`backlog/` to `integrated/` when the founder's `/studio` was built to it
(#1168): `integrated/` went **75 → 76** and `backlog/` went **29 → 28**.

**2026-10-06 (D599), one canvas arrived beside another.** The owner's new
export of `Help Center` adds the ticket screens H3 to H7, drawn by an imported
component, so `Help Ticket Screen.dc.html` now sits next to `Help Center.dc.html`
(which was replaced in place, its route being live): `integrated/` went
**76 → 77**.

**2026-10-06 (D607), two canvases graduated.** `Ops · Boards` and `Ops Page`
moved from `design/incoming/` to `integrated/`, with `ops-data.js`, the script
`Ops Page` loads by that name: `integrated/` went **77 → 79**. Their five
areas run on main: the event organiser (D567), the Account center (D568),
partner earnings (D569), Wellbeing (D570) and the advisor's practice (D571).
They came from the intake queue, not `backlog/`, so `backlog/` did not move.
`Ops Page` is the owner's newer export of the same day, whose one change is
the Account center's section list on a phone.

**2026-10-06 (D606), two canvases arrived with their routes.** The owner's
Eadwyn Tickets canvas (#1107, #1108) is a board, `Eadwyn Tickets`, and the
component every artboard imports, `Eadwyn Tickets Screen`. Its four screens
are built in the same change: the Super Admin's review queue at `/hq/review`
(T1, T1b) and the Eadwyn chat's Tasks and My tickets panels (T2, T3). So both
files went straight to `integrated/`, as `Help Ticket Screen` did:
`integrated/` went **79 → 81**. Nothing left another folder.

**2026-10-06 (D619), two canvases arrived for a live route.** The owner's
archetype canvas for #1006 is a board, `Studio · Archetype card`, and the
component its A24–A30 import, `Archetype Full Sections`. The three sections
those artboards draw on `/studio/archetype` are built in the same change, so
both files went straight to `integrated/`: `integrated/` went **81 → 83**.
Nothing left another folder. The board sits beside `Studio · Archetype
preview` and does not replace it: its artboards are its own. The export left
out the script the component loads its sample data from (D619 names it), so
the component opens with its sections empty.

**2026-10-09 (D660), two canvases graduated from `incoming/`.** The Recording
View and its board (RV1–RV12) are built at `/validate/session/:id` (#1473), so
`Recording View.dc.html`, its board (then `Recording View · Boards.dc.html`,
renamed `Recording View Canvas.dc.html` on 2026-10-13, below) and the
`ring-viz.js` drawing script they load moved to `integrated/`: `integrated/`
went **83 → 85**. `Interview Session.dc.html` stays in `incoming/` until
#1471 builds its structuring rail.

**2026-10-10 (D661), three canvases graduated from `incoming/`.** All four
cycles are wired to their reads (#1474): `/validate`, `/build`, `/raise` and
`/grow` are the overview, and `/:cycle/:module` the module pages. So
`Cycle Overview.dc.html`, its board (then `Cycle Overview · Boards.dc.html`,
renamed `Record a Session · Boards.dc.html` on 2026-10-13, below),
`Cycle Modules · Boards.dc.html` and the `pro-cycles.js` script the overview
then loaded by name moved to `integrated/`: `integrated/` went **85 → 88**. They
came from the intake queue, so `backlog/` did not move. `Cycle Action.dc.html`
and `Cycle Actions · Boards.dc.html` stay in `incoming/`: they belong to the
four primary actions (#1463, #1465, #1466, #1473), not to #1474.

**The `107` in the title is the first audit's corpus, not today's total.** It
is `54 + 26 + 27` — the sum as it stood when `integrated/` read 54. The three
folders hold `83 + 28 + 26 = 137` as of 2026-10-06, counted by listing them,
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

**2026-10-07 (#1165), the Ops canvas took areas 6 to 8 in place.** The owner's
four exports were decoded with `scripts/read-canvas.mjs`: `Ops Page` from
`LH7tQqy7UZJ8vE52o63PRh`, and the board from `2Dsb5K3ryk1Fw3RmrJXGGc`,
`6WQ8iZfuayrMvDWqTrdGEq` and `5aDUDavV2TbGetpr7L1BJW`. All three files were
replaced where they sat, so none moves a number: **`integrated/` stays 83**.

| file | was | is |
| --- | --- | --- |
| `Ops Page` | 82 KB · five areas | **147 KB · eight areas, 25 screens added** |
| `ops-data.js` | 36 KB | **69 KB** |
| `Ops · Boards` | 7 KB · five sets | **11 KB · eight sets: `deals`, `hq` and `pieces` added** |

- **`ops-data.js` is a strict append.** It removes no line. Each of the 25 new
  screen ids is defined in it once.
- **`Ops Page` changes four existing lines,** checked with `diff`.
  - The font link now asks for Space Grotesk 400 to 700. The old link asked
    for 800, a weight the family does not have.
  - The collapsed Eadwyn spine is redrawn.
  - The shell's two role lines gain an `hq` role: a crimson "AXAL VC HQ"
    badge, and an accent per role.
- **The board is the union of three exports.** Each export added one set to
  the five already here, and the shared sets are identical in all three,
  checked rather than assumed. The committed board carries all eight sets in
  area order, with `deals` as the default. It is the one file here that is not
  a single decode.
- **The page loads its script by name,** as on 2026-10-06. The decode leaves
  the script as an asset uuid, which is rewritten to `ops-data.js`.

**2026-10-08 (#1430, #1441), the Ops canvas took Usage and Contracts in place.**
The owner shared two boards drawn on the Ops canvas: Usage (`PeE58rhm5i9DyuhEHCrtir`,
frames U1 to U7) and Contracts (`AQg6bkoiNjCRxtRdPrktKg`, frames K1 to K8). Both
shares carried a newer `Ops Page`, but **neither carried `ops-data.js`**, so every
frame drew only its screen id. The three files were replaced where they sat:
**`integrated/` stays 83**.

| file | was | is |
| --- | --- | --- |
| `Ops Page` | 147 KB · eight areas | **203 KB · 15 screen blocks added** (`us-*`, `hq-allowances`, `ctr-*`) |
| `ops-data.js` | 69 KB | **90 KB** |
| `Ops · Boards` | 11 KB · eight sets | **14 KB · ten sets: `contracts` and `usage` added** |

- **`Ops Page` is the Usage share's decode,** the newer of the two. Every
  screen block in the committed page is still in it, checked with `diff`, and
  its script gains three things: a generic section renderer (`sections`,
  `gtabs`, `moved`), the Contracts head shared by the `ctr-*` screens, and
  `us-*` screens drawn inside the Account center.
- **One line is kept from the committed page:** the font link. The export asks
  again for Space Grotesk 800, which the family does not have, and Google Fonts
  fails the whole request when one weight is missing.
- **The fifteen new data entries are S1's, not the owner's.** They follow the
  two prompts the boards were drawn from: #1430's for Usage, and prompt 2 on
  #1439 for Contracts. Every figure in them is a bracketed placeholder. A header
  comment in `ops-data.js` says so. Replace them if a later share carries the
  owner's own data file.
- **The Account center's section list gains "Usage"** after "Billing and
  orders", as #1430's prompt places it. That one changed line in `ops-data.js`
  is also seen on the six `ac-*` screens.
- **The board keeps all ten sets.** Both shares carried an older board without
  `hq` and `pieces`. Only their `contracts` and `usage` sets were added here,
  and `deals` stays the default.

**2026-10-11 (D673, #1546), the public website.** The owner's new export of
`Axal VC Website` (artifact `QAG7sVsvni2VFiyMNdMsZm`) replaced the committed
canvas in place, which moves no number. It now draws the whole public site, and
it imports two canvases that arrived with it:
- **`Spin-Out Lab Page` went to `integrated/`,** because `/spinout-lab` is live:
  **`integrated/` went 88 → 89.** It is a board of that page, graded `UPGRADE`.
- **`Eadwyn Intelligence Page` went to `backlog/`,** because `/intelligence`
  does not exist yet: **`backlog/` went 28 → 29.** D678 moves it when the page ships.

The export's 24 images, and the two the Lab board inlined, are WebP files in
`frontend/public/site/`, the copy the pages ship. The three canvases point at
them with `../../../frontend/public/site/<name>.webp`, so the repository holds
each image once. The website's `dc-import` of `Eadwyn Intelligence Page`
resolves only when both files sit in one folder, which they will once D678
moves it.

**2026-10-12 (D678, #1552), one canvas graduated.** `Eadwyn Intelligence Page`
moved from `backlog/` to `integrated/` with its route, `/intelligence`:
**`integrated/` went 89 → 90 and `backlog/` went 29 → 28.** It now sits beside
`Axal VC Website`, so the website's `dc-import` of it resolves. Its two
`ead-*.webp` paths were already `../../../frontend/public/site/…` and did not
change; its two `eadwyn-ai.png` references named a file next to the canvas
that never existed, and now point at `../../../frontend/public/eadwyn-ai.png`.
It is graded `UPGRADE`: the page ships only the claims the code makes true,
and D678 lists the rest.

**2026-10-13 (D685), Record a session: four files in place, two of them
renamed.** The owner republished artifact `Fxui55FyoHTWvTDi1iXysL`, which the
D656 landing called "the overview board". It is now named "Record a Session ·
Boards", and its bundle carries the board plus the five canvases it imports.
Every file was replaced or renamed where it sat, so none moves a number:
**`integrated/` stays 90.**

| file | was | is |
| --- | --- | --- |
| `Cycle Overview.dc.html` | 55 KB · loads `pro-cycles.js` | **91 KB · its data inline.** Adds the Record a session setup modal (`lbOpen`), the full-screen Recording View mount (`recOpen`), and a centred lightbox for the other three cycle actions (`sheetOpen`, importing `Cycle Action`). Also adds real hrefs, a history tab second in each cycle's tabs, linked Interviews rows, a phone layout (`mobile`) and new-venture states for Build, Raise and Grow. |
| `Recording View.dc.html` | 14 KB | **15 KB.** Adds a `callLabel` pill, `onClose` on "Exit full screen", and the two video tiles. |
| `Recording View Canvas.dc.html`, renamed from `Recording View · Boards.dc.html` | 11 KB · RV1–RV13 | **7 KB · RV1–RV13 unchanged.** The ring import now reads `from="./ring-viz.js"`, the sibling file, where the old board named an asset uuid; the rest of the difference is the branding strip and serialisation. |
| `Record a Session · Boards.dc.html`, renamed from `Cycle Overview · Boards.dc.html` | 8 KB · O1–O5 | **5 KB.** Adds O2n, O3n and O4n, passes `page`, `module` and `mobile` to Cycle Overview, and adds a `#recording` section. That section imports Recording View Canvas and names the routes `/validate/record` → `/validate/record/live`. |

- **The renames use Claude Design's new names,** so a later export matches
  them by name. They were made with `git mv`, so each file's history follows it.
- **The board was normalised with `scripts/read-canvas.mjs`.** The bundle's
  copy of it still named the runtime by its asset uuid and inlined 21
  `@font-face` rules. A bundle rebuilt from its decoded assets went through the
  decoder: `src="./support.js"`, one Inter 400/600/800 link, no branding strip, and no
  asset left unplaced. The other three arrived as the bundle's source files and
  were already in this folder's form.
- **Neither board carries the "Made with Claude Design" strip now.** Both old
  board files did, because the D656 landing unpacked them without the decoder.
  `Cycle Modules · Boards.dc.html` was not re-exported, and still carries it.
- **`pro-cycles.js` stays,** although the new Cycle Overview no longer loads it
  (no `<script src="pro-cycles.js">`, no `PRO_CYCLES`). D656 and D661 cite it,
  and it is the record of the Pro parts the earlier export drew. `ring-viz.js`
  is still loaded by Recording View and Recording View Canvas.
- **The other two files in the bundle are in `design/incoming/`.** `AIRail` is
  byte-identical to the copy there. `Cycle Action` was replaced there in place:
  its × now closes the lightbox.
- What the design asks for, what is built, and who builds the rest:
  `documentation/architecture/decisions/D685.md`.

**2026-10-15 (D698, #1660), one canvas graduated.** `AIRail` moved from
`design/incoming/` to `integrated/`, unedited, with its build: every
`WorkerRail` now draws it as "Eadwyn AI". **`integrated/` went 90 → 91.** It
now sits beside `Cycle Overview`, so CO's two `dc-import`s of it (the phone
panel at CO:34 and the desktop rail at CO:125) resolve. The older
`backlog/AIRail.dc.html` stays, because the backlog's Founder Workspaces
Canvas imports it. The incoming Founder Workspaces Canvas also imports
AIRail, and that import no longer resolves inside `incoming/`
(`design/incoming/README.md` says so). Every departure from the canvas is
listed in `documentation/architecture/decisions/D698.md`.

**2026-10-17 (D700, #1662), two canvases graduated.** `Account Menu · Mobile`
and `Account Mobile Page` moved from `design/incoming/` to `integrated/`
together, unedited, because AM imports AMP by name (AM:17). All ten account
pages, A1m–A10m, now draw their phone view below 1024px. **`integrated/`
went 91 → 93.** Every departure from the canvas is listed in
`documentation/architecture/decisions/D700.md`.

**2026-10-17 (D702, #1664), two more graduated.** `Studio · Mobile` and
`Studio Mobile Page` moved from `design/incoming/` to `integrated/` together,
unedited, because SM imports SMP by name (SM:20). D701 (#1663) built S1m–S5m
(Studio on a phone and the Eadwyn menu) and D702 built S6m–S10m (You, Your
venture, the archetype card on a phone, What others see and Visibility).
**`integrated/` went 93 → 95.** The departures are in
`documentation/architecture/decisions/D702.md`.

**2026-10-17 (D703, #1665), two more graduated.** `Cycle Overviews · Mobile`
and `Cycle Modules · Mobile` moved from `design/incoming/` to `integrated/`,
unedited, where their `Cycle Overview` import resolves. Below 1024px each
cycle root is its One Next Thing, and each module, add form and cycle action
is its own page; the phone record page follows in #1665's closing PR.
**`integrated/` went 95 → 97.** The departures are in
`documentation/architecture/decisions/D703.md`.

**2026-10-19 (D717, #1854), one graduated.** `Legal Documents · Templates`
moved from `design/incoming/` to `integrated/`, unedited, when #1854 closed
#1782: the Templates tab (#1851, #1852, #1853, #1854), the entity and money
map (#1855), the bank-account registry (#1856), signing (#1857) and the LP's
wire details and fee statement (#1859) are built to it. The LP screens #1858,
#1860 and #1866 and D758's library work keep their own issues.
**`integrated/` went 97 → 98.** The departures are in
`documentation/architecture/decisions/D717.md`.
