# frontend/src/pages/raise/captable — the Cap table tool

The founder's Cap table tool at `/raise/cap-table` (D1015, #2432), built to the
owner's "Cap table" canvas: `design/incoming/Raise Cap Table Page.dc.html` and
`design/incoming/Cap Table · Boards.dc.html` (CT1–CT24).

| File | What it is |
|---|---|
| `CapTableTool.jsx` | The tool's tab bar (`CapTableTabBar`) and Overview's tab bar with the Modelled line (`CapTableHomeNav`), drawn under the module page's header, and its tab pages (`CapTableTabPage`): Instruments, Option pool and Scenarios. |
| `capTableModel.js` | Pure: the addresses, the tabs, the words, and every derivation from the reads (the SAFEs sent through StudioOS, the model's instruments and conversion lines, its pool, the 409A, the scenario cards). |
| `CapTableOverview.jsx` | D1022 (#2859): Overview's record blocks under the tabs — the tool bar, Needs you with each proposal's dialog, Who owns by holder and by class, the tiles, the three bars and the instruments — and the states CT16, CT19–CT22 and CT24. Record an issuance and Void are part 10's, taken as `onRecord` and `onVoid`. |
| `HolderDrawer.jsx` | D1022: the holder drawer (CT2, CT2p) at `/raise/cap-table/h-<n>`: positions, issuances with their documents or "No document", a person's vesting and 83(b), and what they can see. |
| `overviewModel.js` | D1022, pure: every figure of Overview's record blocks and the drawer, from the record (D1017), the grants (D1019), the equity plan (D1020) and the model's last round. |
| `CapTableTag.jsx` | The On record and Modelled tags. |

## Where the tool lives

The tool is the Cap table module, not a page beside it. Overview is
CycleRoute's module page (`../../cycles/CycleModulePage.jsx`), which already
draws the Planned round card, the Holders records, From Mercury and Eadwyn's
two bands. The tab words (`/instruments`, `/option-pool`, `/scenarios`) arrive
on the module's record route, `/raise/:slug/:id`, and CycleRoute draws
`CapTableTabPage` for them instead of a record (`isCapTableTab`). A holder's
address, `h-<n>`, opens the holder drawer over Overview (D1022); `e-<n>` and
`pool` are still records, and `/new` is still Add holder. No route is added.

## The rules for adding here

- **On record and Modelled never share a number without a tag.** A figure
  from the record (D1017, `GET /api/captable/record/:projectId`) is On record;
  a figure from the saved model carries the Modelled tag; a SAFE sent through
  StudioOS is On record once countersigned.
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
