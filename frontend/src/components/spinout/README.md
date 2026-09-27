# components/spinout — Spin-Out Lab shared pieces

Pieces more than one Spin-Out Lab page renders. The Lab's pages live in
`frontend/src/pages/` (`SpinoutLab*Page.jsx`, `SpinoutLabWorkspace.jsx`); what
they share lives here, so a tool page and its admin preview draw the same thing.

| File | What it is |
| --- | --- |
| `LabPageShell.jsx` | The outer wrapper of every Lab tool page: gutters and per-tool max width. |
| `LabPageHeader.jsx` | The one tool-page header. |
| `LabPageIcon.jsx` | The violet icon tile in that header. |
| `RevenueLedger.jsx` | The Revenue page's per-customer entry ledger (D363): filters, investor view, manual entry, CSV import with column mapping, proof attachment, mix and confidence, over `/api/revenue`. Sums are integer cents via `../../lib/revenueLedger.js`. |
| `LabBackLink.jsx` | "← Back to Workspace", the Lab's return control. |
| `labStyles.js` | The shared status chip and quick-action button classes. |
| `LabIntro.jsx` | The programme introduction, on both `/spinout-lab` surfaces. |
| `labIntroStyles.js` | The token pairs the introduction's two surfaces share, light and dark. |
| `ApplicationStatus.jsx` | The application status screen on `/spinout-lab/apply` and its short card on `/spinout-lab` (D384), both read from `/state`'s `applicant` block. |

## Rules

- **Every Lab tool page renders `LabPageShell`**; `spinout_lab_spacing.test.mjs`
  fails a page that owns its own gutters.
- **Nothing here fetches.** The page reads `/state` once and passes it down, so
  two pieces on one screen cannot disagree about the same application.
- **Absent is drawn as absent.** A date, name or count no row records is left
  out or said as not recorded — never filled from the canvas's sample.
