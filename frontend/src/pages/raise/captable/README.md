# frontend/src/pages/raise/captable — the Cap table tool

The founder's Cap table tool at `/raise/cap-table` (D1015, #2432), built to the
owner's "Cap table" canvas: `design/incoming/Raise Cap Table Page.dc.html` and
`design/incoming/Cap Table · Boards.dc.html` (CT1–CT24).

| File | What it is |
|---|---|
| `CapTableTool.jsx` | The tool's tab bar (`CapTableTabBar`) and Overview's tab bar with the Modelled line (`CapTableHomeNav`), drawn under the module page's header, and its tab pages (`CapTableTabPage`): Instruments, Option pool and Scenarios. |
| `capTableModel.js` | Pure: the addresses, the tabs, the words, and every derivation from the reads (the SAFEs sent through StudioOS, the model's instruments and conversion lines, its pool, the 409A, the scenario cards). |

## Where the tool lives

The tool is the Cap table module, not a page beside it. Overview is
CycleRoute's module page (`../../cycles/CycleModulePage.jsx`), which already
draws the Planned round card, the Holders records, From Mercury and Eadwyn's
two bands. The tab words (`/instruments`, `/option-pool`, `/scenarios`) arrive
on the module's record route, `/raise/:slug/:id`, and CycleRoute draws
`CapTableTabPage` for them instead of a record (`isCapTableTab`). A row's own
page is still its id (`h-<n>`, `e-<n>`, `pool`), and `/new` is still Add
holder. No route is added.

## The rules for adding here

- **On record and Modelled never share a number without a tag.** Nothing
  records what was issued yet: a figure from the saved model carries the
  Modelled tag, and only a countersigned SAFE is On record. When part 2's
  record lands, its figures are On record and the model's stay Modelled.
- **Every figure comes from a mounted read.** A read that fails says so where
  its figure would be, a refusal is never "none", and a value nobody recorded
  reads "Not recorded", never `$0` or `0%`. No canvas sample (`[Acme
  Robotics]`, `[$500,000]`) reaches a page.
- **Money in its own unit.** The model is whole dollars; SAFE issuances are the
  currency's smallest unit with their currency code; discounts and rates are
  fractions.
- **A tab waits for its read** (D953's rule). History, Access and Import and
  export have none yet. Each is a slot task on #2432 (D1015 §6): build the tab
  in the PR that builds its read, add its derivation to `capTableModel.js`,
  and test it in `frontend/test/captable_tool_d1015.test.mjs` or its own file.
- **Every change opens a dialog that says what it changes and who sees it.**
  Never `alert` or `confirm`.
- **Eadwyn never fills an amount, cap, discount, price or share count** (#2431).
