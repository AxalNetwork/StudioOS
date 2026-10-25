# frontend/src/pages/raise/captable — the Cap table tool

The founder's Cap table tool at `/raise/cap-table` (D1015, #2432), built to the
owner's "Cap table" canvas: `design/incoming/Raise Cap Table Page.dc.html` and
`design/incoming/Cap Table · Boards.dc.html` (CT1–CT24).

| File | What it is |
|---|---|
| `CapTableTool.jsx` | The tool's tab bar (`CapTableTabBar`) and Overview's tab bar with the Modelled line (`CapTableHomeNav`), drawn under the module page's header, and its tab pages (`CapTableTabPage`), Scenarios drawn here and the others from their own files. |
| `capTableModel.js` | Pure: the addresses, the tabs, the words, and the shared derivations (money, dates, the 409A, the scenario cards). |
| `InstrumentsTab.jsx` | D1023 (#2860): Instruments (CT3, CT3b): the record's SAFEs and notes with the toolbar, Convert at a price or a scenario, the modelled columns and chart, the over-100% notice; and the instrument drawer (CT4) at `/raise/cap-table/instrument/<uid>`. |
| `instrumentsModel.js` | D1023, pure: each instrument from the record, the toolbar, Convert at's body, the engine's conversion as columns, bars and steps, MFN and the exit before conversion. |
| `OptionPoolTab.jsx` | D1023: Option pool (CT5, CT5c): the tiles, the burn-down with the model's target, the 409A with Record a valuation and Record an event, Top up the pool, and the grants (Carta's read only). |
| `poolModel.js` | D1023, pure: the tiles, the burn-down by month, the grants from the venture's plan, and the 409A dialogs' bodies. |
| `AccessTab.jsx` | Access (CT13, D1026): who sees what, the levels, the share links and the access log; the owner changes, a co-founder reads. |
| `ImportExportTab.jsx` | Import and export (CT14, D1026): Carta's binding, a spreadsheet to proposals, Mercury's SAFE requests, the three exports. |
| `SharedCapTable.jsx` | The read for an Advisor, an Operating Partner, an Admin and the Super Admin (CT17, CT18) at `/cap-tables/:projectId`, and the venture link's page. |
| `CapTableDialog.jsx` | The in-page dialog every change opens, with the Worker's refusal under its buttons. |
| `capTableAccess.js` | Pure: the levels, the grants, links and log rows, New link's and the support reason's checks, and each level's view. |
| `capTableImport.js` | Pure: the template, the CSV parse, the column map and the preview's checks against the record. |
| `CapTableOverview.jsx` | D1022 (#2859): Overview's record blocks under the tabs — the tool bar, Needs you with each proposal's dialog, Who owns by holder and by class, the tiles, the three bars and the instruments — and the states CT16, CT19–CT22 and CT24. Record an issuance and Void are part 10's, taken as `onRecord` and `onVoid`. |
| `HolderDrawer.jsx` | D1022: the holder drawer (CT2, CT2p) at `/raise/cap-table/h-<n>`: positions, issuances with their documents or "No document", a person's vesting and 83(b), and what they can see. |
| `overviewModel.js` | D1022, pure: every figure of Overview's record blocks and the drawer, from the record (D1017), the grants (D1019), the equity plan (D1020) and the model's last round. |
| `HistoryTab.jsx` | D1025 (#2862): History (CT10) at `/raise/cap-table/history`: the record's timeline with its toolbar and pages of 25, and Changes to scenarios and access, each read alone; Void and Correct on a recorded row. |
| `ProposalDrawer.jsx` | D1025: one proposal at `/raise/cap-table/proposal/<id>` (CT11a–b): a Mercury SAFE request (`mercury-<n>`), a close's investors together, or a person's or an import's proposal. |
| `IssuanceDialogs.jsx` | D1025: Record an issuance or Propose one (CT12a) at `/new`, Eadwyn's draft from a signed file (CT11c), Void (CT12b) and an admin's correction (CT12c). |
| `historyModel.js` | D1025, pure: the timeline's and the changes' lines, the toolbar's filters, each dialog's body in the record's units, and each drawer's view. |
| `CapTableTag.jsx` | The On record and Modelled tags. |

## Where the tool lives

The tool is the Cap table module, not a page beside it. Overview is
CycleRoute's module page (`../../cycles/CycleModulePage.jsx`), which already
draws the Planned round card, the Holders records, From Mercury and Eadwyn's
two bands. The tab words (`/instruments`, `/option-pool`, `/scenarios`) arrive
on the module's record route, `/raise/:slug/:id`, and CycleRoute draws
`CapTableTabPage` for them instead of a record (`isCapTableTab`). A holder's
address, `h-<n>`, opens the holder drawer over Overview (D1022); `e-<n>` and
`pool` are still records. `/new` is Record an issuance over Overview (D1025). Two drawers have routes
of their own: a proposal's, `/raise/cap-table/proposal/<id>` (D1025), and an
instrument's, `/raise/cap-table/instrument/<uid>`, over Instruments (D1023).

## The rules for adding here

- **On record and Modelled never share a number without a tag.** A figure
  from the record (D1017, `GET /api/captable/record/:projectId`) is On record;
  a figure from the saved model, or from a round run from Today (D1018),
  carries the Modelled tag.
- **Every figure comes from a mounted read.** A read that fails says so where
  its figure would be, a refusal is never "none", and a value nobody recorded
  reads "Not recorded", never `$0` or `0%`. No canvas sample (`[Acme
  Robotics]`, `[$500,000]`) reaches a page.
- **Money in its own unit.** The model is whole dollars; SAFE issuances are the
  currency's smallest unit with their currency code; discounts and rates are
  fractions.
- **A tab waits for its read** (D953's rule): build the tab in the PR that
  builds its read, add its derivation to a pure module here, and test it in
  its own file. History reads D1017's history by section (D1025); Access and
  Import and export read D1019's, D1020's and D1017's routes (D1026).
- **Imports land as proposals, never on the record.** A row that matches the
  record is left out, so nothing counts twice.
- **A control a profile cannot use is left out**, with one line saying why
  (a co-founder on Access). Who reads at which level is the Worker's answer
  (`via`, `level`), never a role the page guessed.
- **Every change opens a dialog that says what it changes and who sees it.**
  Never `alert` or `confirm`.
- **Eadwyn never fills an amount, cap, discount, price or share count** (#2431).

D1130 moves venture access/share views and holder choices to recorded issuances.
Option pool reads venture grants and holder-linked 83(b) filings; an unreadable
filing block leaves the grants visible, and an unstored filing date stays Not
recorded. Company creation's existing dialogs record the filing and proof.
