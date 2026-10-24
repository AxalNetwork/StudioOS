# frontend/src/pages/raise/narrative — the Investor narrative tool

The founder's Investor narrative tool at `/raise/investor-narrative` (D906,
#2454), built to the owner's "Investor narrative" canvas:
`design/incoming/Investor Narrative Page.dc.html` and
`design/incoming/Investor Narrative · Boards.dc.html` (NAR1–NAR21).

| File | What it is |
|---|---|
| `NarrativeTool.jsx` | The tool's tab bar (`NarrativeTabBar`), drawn under the module page's header on Home, and its tab pages (`NarrativeTabPage`): Story, Positioning, Check and Versions with Compare. |
| `NarrativeAdmin.jsx` | D914 (#2698): an admin's reason gate and the NAR13 read-only banner, the notes thread, the founder's "Who read this narrative", and the NAR14a and NAR14b panels. |
| `narrativeModel.js` | Pure: the addresses, the tabs, the words, and every derivation from the reads (the saved versions, one version's words and its consistency check, two versions side by side, the positioning rows; D909's tiles, Needs you, footer, based-on and Read by lines, and New version's "Creates v[n] for …" line). |
| `PositioningTab.jsx` | D911: the Positioning tab. NAR4's core positioning and "This version", NAR5's proposal lightbox (Accept or Discard, one at a time), and NAR18's moved notice. |
| `PitchPositioningRedirect.jsx` | D911: `/raise/pitch/positioning`, now a redirect to the tab that keeps the query and hash and adds `?moved=positioning`. |

D909 (#2693) adds `NarrativeHome` to `NarrativeTool.jsx`: Home's tiles, Needs
you and footer. CycleRoute draws it as the module's part
(`CYCLE_DEFS.raise.parts`) from the module read's `parts.narrative`. The
Versions tab reads that part for each version's based-on line and Read by,
compares through D908's `GET /narrative/compare`, and offers Duplicate (behind
a dialog) and "Make vN the start of a new version" (`/new?start_from=version-N`).


## Where the tool lives

The tool is the Investor narrative module, not a page beside it. Home is
CycleRoute's module page (`../../cycles/CycleModulePage.jsx`), which already
draws the versions card, the versions table, From Mercury and Eadwyn's
"Phrase the fix". The tab words (`/story`, `/positioning`, `/check`,
`/versions`) arrive on the module's record route, `/raise/:slug/:id`, and
CycleRoute draws `NarrativeTabPage` for them instead of a record
(`isNarrativeTab`). A version's own page is still its number
(`/raise/investor-narrative/4`), and `/new` is still New version. No route is
added, so every cycle-route rule (`cyclePaths.js`, `cycle_spacing_d694`) holds.

## The rules for adding here

- **Every figure comes from a mounted read.** A read that fails says so where its
  figure would be; a value nobody recorded reads "Not recorded", never 0. No
  canvas sample (`[Northwind Labs]`, `[$18,400]`) ever reaches a page.
- **A tile with no store is a dash with its reason, never 0** (D909). Claims
  backed waits for #2430 and Objections answered for #2457.
- **A board waits for its store.** Claims (#2430), bound figures and the
  sections store, the deck side of the check (#2434) and
  objections (#2457) need stores the Worker does not have. Each is a slot task
  on #2454 (D906 §6). Build a board in the PR that builds its
  read, add its derivation to `narrativeModel.js`, and test it in
  `frontend/test/narrative_tool_d906.test.mjs` or its own file.
- **The check is drawn in the Worker's own words.** The page states each figure's
  result as the consistency section sends it and re-derives nothing; the
  check's own fixes are #2447 and D906 part 1.
- **An admin reads, and changes nothing** (D914). `CycleRoute` wraps every
  narrative page in `NarrativeAdminGate` for an admin: a reason first, then the
  page read only, with no New version, Add, edit, fill or draft. The Worker
  refuses their writes (`admin_read_only`) and their reads without a reason
  (`read_reason_required`) on its own; the page only draws what it answers.


The D914 read-only flag also reaches D911's Positioning tab: admins read its core and version wording, with no edit, Adjust, proposal or decision controls. The corresponding draft and proposal routes use the narrative's read/write gate.
