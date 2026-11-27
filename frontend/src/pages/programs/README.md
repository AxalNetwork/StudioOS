# `frontend/src/pages/programs/` — program presentations and their map (D6966, #6965)

One public page and one 16:9 PDF per program, telling the same story in the same order.
The Spin-Out Lab pilot (#6966, decision `D6966-p2.md`) built the kit; the nine programs of
#6965 (#6967 to #6975) each add one program, in parallel. **Adding a program adds files and
edits nothing shared**, so those PRs never conflict with each other.

## What lives here

| Path | What it is |
| --- | --- |
| `catalog/` | The map: one file per program, `catalog/<key>.js`, default-exporting its entry (registry key → canonical page → committed PDF, the availability word, the name, purpose, audience, edition, slide count, link-preview title and description, and the index card's line). Plain data with no imports: Node scripts read it too. |
| `content/` | One file per program, `content/<key>.js`: sections 1 to 4 of its page, the Next step band, its fixed availability panel when it has no live read, and its slides. Written in the block vocabulary below. It may import app code (the Lab reads its week names from `frontend/src/lib/spinoutLab.js`). |
| `collect.js` | The rules: the availability words, the five section names, the checks on an entry, and `collectPrograms`. |
| `registry.jsx` | The map, collected with `import.meta.glob` (a JSX module, so the node test loader expands the glob): `PROGRAMS`, `programFor(key)`, `presentationHref(key)`, `loadContent(key)`. |
| `kit.jsx`, `programs.css` | The page kit (PGS00): availability label, Download PDF, Print, the panel, the hero, the section nav, the sections, the journey, the Next step band. In today's public-site frame (`SitePage`), light only. |
| `deck.js` | The slide master (PGS04): the deck as HTML and its stylesheet (`DECK_CSS`), for the PDF builder only. |
| `AdminPresentationLinks.jsx` | The admin entry points (PGS07), derived from the map: the program's name on /admin/programs opens its presentation, "Open" reads "Manage program", and the program's admin header gains "View presentation". |

The routes are `frontend/src/routes/programs.jsx`: `/programs` is `ProgramsIndexPage.jsx` and
`/programs/:key` is `ProgramKeyPage.jsx` (here). Spin-Out Lab's own page is
`frontend/src/pages/SpinoutLabBriefPage.jsx`. The PDFs are `frontend/public/program-briefs/`.

## Add a program

Four new files; nothing else changes.

1. **`catalog/<key>.js`** — the map entry. `<key>` is the registry key (`programsModel.js`
   `PROGRAMS`), and the file is named after it. Copy `catalog/spinout-lab.js` and change every
   field. `canonical` is `/programs/<key>` for a program with no page of its own; a program
   whose page already exists (Influencers: `/influencers`) names that page, and
   `/programs/<key>` resolves to it. `pdf` is `/program-briefs/axal-vc-<key>-v1.pdf`.
   `avail` is one of `AVAILABILITY` in `collect.js`; a program whose canvas words it
   differently keeps the closest key and sets `availText` to the canvas's words (do not add a
   key to `AVAILABILITY` for one program).
2. **`content/<key>.js`** — default-export `{ sections, next, panel, cover, slides, closing }`:
   - `sections`: sections 1 to 4, in order (Who it helps, What they do, How participation
     works, Access required), each `{ title, lead?, band?, blocks: [...] }`. A section with
     nothing to say says so in one line; it is never dropped or reordered.
   - `next`: section 5, `{ title, band, actions: [{ id, who, label, kind, to, note }] }`,
     `kind` being `primary` (at most one), `link` or `quiet`.
   - `panel`: the availability panel when the page reads nothing live:
     `{ text, note?, action?: { id, label, to } }`.
   - `cover: { art?, alt }` (`art` is a file under `frontend/public/site/`), `slides` (the
     middle slides, each `{ eyebrow, title, blocks, alt }`) and `closing`
     (`{ title, rows: [[label, value]], next: [[label, 'axal.vc/…', line]], alt }`). Cover +
     slides + closing must equal the entry's `slides`.
   - Page blocks: `cards`, `aside`, `timeline`, `cols`, `card`, `stages`, `list`, `terms`,
     `limits`. Slide blocks: `cards`, `timeline`, `two`, `stages`, `list`. `kit.jsx` `Block`
     and `deck.js` `slideBlock` are the definitions.
3. **The PDF.** `node scripts/build-program-briefs.mjs <key>` writes
   `frontend/public/program-briefs/axal-vc-<key>-v1.pdf` from the two files above (set
   `PW_CHROMIUM_PATH` when Playwright's pinned Chromium is not installed). Commit it. Keep it
   under 500 KB (`scripts/lfs-size-gate.mjs`): cover art is re-encoded as JPEG; a bigger file
   must be LFS-tracked first. Never edit the PDF by hand; change the source and rebuild.
4. **A test**, `frontend/test/program_<key>_<issue>.test.mjs`, for what is the program's own.
   `frontend/test/program_presentations_6966.test.mjs` already checks every map entry: the file
   exists and starts `%PDF-`, its href is same-origin, no two programs share a file, the page
   count matches, and the admin and index links follow the map.

What comes for free: `/programs/<key>` (or the redirect to the canonical page), the index card
on `/programs`, the link preview (`scripts/prerender-og.mjs` reads the map), the name link,
"Manage program" and "View presentation" on /admin/programs (where the program's admin page
uses `ProgramFrame` or adds `ViewPresentationLink` itself), and the PDF check. A program with a
page of its own (Influencers) mounts the kit's pieces there instead of `/programs/<key>`.

Do not edit `registry.jsx`, `ogRegistry.js`, `sitemap.xml` (the index is in it and links every
program), `App.jsx` or another program's files.

## Rules

- The page and the PDF tell one story; the PDF reads nothing live. A cohort, date, place,
  count or status that changes lives on the page, from its read, never in the PDF.
- No invented availability, fee, result, endorsement or quote. A value with no store says
  "Not recorded"; a failed read says "Unavailable" and is never a statement that something is
  closed (AGENTS.md § House rules, Honesty).
- Download PDF is an ink outline and a plain same-origin link with `download`; the one violet
  action is participation; Print, sign in and an enquiry are quieter and apart.
- A revision of a PDF is a new file (`-v2`) and a change to the entry's `pdf` and `edition`;
  the page's address never changes.

D7121 part 3 registers Wellness through `catalog/wellness.js`. Its literal
public route and approved page/deck remain in `pages/wellbeing/`; the shared
PDF command delegates to the existing bespoke renderer. The admin header
separates View presentation from the eligible Open My Wellbeing action.
