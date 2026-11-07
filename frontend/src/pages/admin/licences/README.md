# The HQ licence page, by domain

#4707: `../AdminLicences.jsx` is the page at `/admin/licences`. It reads the
ledger a page at a time (#4700), keeps the selected licence, its tab and the
kind filter in the URL, and draws the list and the detail pane. Everything the
detail pane renders lives here, one file per domain, moved out of that page
unchanged when it was split.

- `LicenceDetail.jsx` — lifecycle: one licence, its header, its actions
  (activate, suspend, reinstate, renew, terminate) and its tab bar.
- `TerritoryEditor.jsx` — step 2, the countries a licence holds.
- `CommercialTerms.jsx` — steps 3 and 4: `SeatEditor` and `TermsEditor`.
- `ContractStep.jsx` — step 5, the contract instantiated from a template.
- `DeployStep.jsx` — step 6, the branch deployment.
- `AdminsEditor.jsx` — the licence's administrators: appoint, demote, detach.
- `NoticesEditor.jsx` — compliance notices and their review.
- `BrandKitEditor.jsx` — the brand kit, white-label licences only.
- `Coverage.jsx` — the EU coverage grid and the renewal pipeline above the list.
- `licenceShared.jsx` — what the parts share: tones, seat types, step numbers,
  residency choices, `Chip` and `Field`.

The models these read stay beside the page in `../`: `licenceNavModel.js`
(tabs and selection), `licenceReasonModel.js` and `LicenceReasonDialog.jsx`
(reasons), `licenceHistoryModel.js` and `LicenceHistory.jsx` (history).

**Rule for adding to it.** A new licence domain is a new file here, imported
by `LicenceDetail.jsx`. Tests that read the page as text read every file here
through `frontend/test/_licencePage.mjs`, so moving code between these files
does not break them.
