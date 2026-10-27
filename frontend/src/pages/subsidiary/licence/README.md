# The Licences page's tabs

The tabs of a studio Administrator's own licence page, `/admin/my-licence/<tab>`
(D800, #2233; the canvas `Licences Page.dc.html`). `../MyLicencePage.jsx` reads
the tab from the path and mounts one of these; Summary and Terms are
`../LicenceSummary.jsx` and `../LicenceTerms.jsx`, and the header and tab row
are `../LicenceFrame.jsx`.

- `ContractTab.jsx` — the contract in force and the one waiting (D804).
- `StatementsTab.jsx` — HQ's statements and disputing a line (D804).
- `RequestsTab.jsx` — the six requests to HQ, the renewal timeline and "Your
  requests" with HQ's answers (D804; the sixth, Request a program, is D988's).
- `RequestChangeSheet.jsx` — the "Request a change" sheet for the licence's
  own terms and seats (D804), the shared right-side `Sheet` (D1317).
- `ProgramsTab.jsx` — the programs HQ grants this studio, their terms and the
  partner deal types HQ allows (D981, D988; canvas `Program Grants Page.dc.html`
  GR7–GR15).
- `ProgramTermsDialog.jsx` — one program's terms, read only (GR8), as the
  shared right-side `Sheet` (D1317).
- `ProgramRequestSheet.jsx` — "Request a program" (GR9), D983's three program
  requests, the shared right-side `Sheet` (D1317).
- `licenceTabsModel.js` — the Contract, Statements and Requests tabs as pure
  functions. The Programs tab's model is `../../../lib/studioPrograms.js`.

## Rules

- HQ writes licences and grants; the Administrator reads them and asks. The
  only writes here are requests (`../../../lib/api/licenceRequests.js`) and a
  statement dispute (`api.disputeStatement`), and nothing changes until HQ
  answers.
- Every change opens an in-page sheet or dialog that says what it sends. Never
  a browser pop-up.
- A value no read carried says "Not recorded", never a zero. A failed read says
  so with Try again, and one failed block never blanks the tab.
- A grant with no row is "Not recorded", never "Not granted" (D981 §3).
