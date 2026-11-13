# The HQ licence page, by domain

#4707: `../AdminLicences.jsx` is the page at `/admin/licences`. It reads the
ledger a page at a time (#4700), keeps the selected licence, its tab and the
kind filter in the URL, and draws the list and the detail pane. Everything the
detail pane renders lives here, one file per domain, moved out of that page
unchanged when it was split.

- `LicenceDetail.jsx` — lifecycle: one licence, its actions (activate,
  suspend, reinstate, renew, terminate) and its sections. D4819 part 3: the
  canvas's six sections (Overview, Terms, Agreement, Access, Operations,
  History) as the first tab row, and each section's tabs as a second row.
- `LicenceIdentity.jsx` — D4819 part 3: the identity header (name, reference,
  territory, type, status, renewal, executed agreement, branch sync), each
  fact in its own state.
- `LicenceOverview.jsx` — D4819 part 3: the Overview section (L03, L04): seven
  separate facts and Sources, the Needs HQ strip, and `useOverviewReads`, the
  reads the header and the Overview share.
- `TerritoryEditor.jsx` — step 2, the countries a licence holds.
- `CommercialTerms.jsx` — step 3: `SeatEditor` (step 4 is `TermsWorkspace.jsx`).
- `ContractStep.jsx` — step 5, the contract instantiated from a template (D5051: block 1 of the Agreement
  section, with its record in Contracts and its version history).
- `LicenceAgreements.jsx` — D5051 (#5051): the Agreement section's other blocks (L33): the Axal VC package
  agreement, the licensed program agreements (each linking to its one record in Contracts), package readiness,
  Needs HQ · legal and the legal history. Reads the D5048 and D5052 licence reads, each its own block; creates
  nothing. Its `StatePill`, `ReadFailed` and `useBlockRead` are shared with `../grants/ProgramLegalAccess.jsx`.
- `DeployStep.jsx` — step 6, the branch deployment.
- `AdminsEditor.jsx` — the licence's administrators: appoint, demote, detach.
- `NoticesEditor.jsx` — compliance notices and their review.
- `BrandKitEditor.jsx` — the brand kit, white-label licences only.
- `LicenceSyncStrip.jsx` — branch sync (HQ and branch revision, last sync, pending revision and why) and the
  unfinished-termination notice with its resume button (#4686). D4819 part 3 draws the strip on
  Operations › Branch and domain and the notice above the sections.
- `Coverage.jsx` — the EU coverage grid and the renewal pipeline above the list.
- `licenceShared.jsx` — what the parts share: tones, seat types, step numbers,
  residency choices, `Chip` and `Field`.
- `LedgerZero.jsx` — D4819 (#4819): the ledger's true zero state ("No licences
  have been issued", Issue first licence, Why is this empty?), the one-line EU
  coverage that opens `Coverage.jsx`'s grid, and seat utilisation as Not recorded.
- `LedgerTable.jsx` — D4819: the populated ledger: the counts line, Needs HQ
  (each item a filter of the table) and the nine-column table, a stacked list
  on a phone. Its rows are the doors to one licence.
- `LicenceDeepLink.jsx` — D4819: `/admin/licences/:uid` and
  `/admin/licences/:uid/:section`, opened on that section's first tab.
- `TermsWorkspace.jsx` — D4819 part 2: the Terms section (L05 to L07): the
  schedule read-only by default, Amend terms as a reviewed session, and the
  conflict view when another admin wrote first. It replaced step 4's editor.

The models these read stay beside the page in `../`: `licenceNavModel.js`
(sections, tabs and selection), `licenceOverviewModel.js` (the header's and
the Overview's facts, D4819), `licenceLedgerModel.js` (the ledger's cells, Needs HQ and
the zero test, D4819), `licenceTermsAmendModel.js` (the Terms section's rows,
amendment, effects and conflict, D4819), `licenceReasonModel.js` and `LicenceReasonDialog.jsx`
(reasons), `licenceHistoryModel.js` and `LicenceHistory.jsx` (history).

**Rule for adding to it.** A new licence domain is a new file here, imported
by `LicenceDetail.jsx`. Tests that read the page as text read every file here
through `frontend/test/_licencePage.mjs`, so moving code between these files
does not break them.
