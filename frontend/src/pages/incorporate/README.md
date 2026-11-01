# frontend/src/pages/incorporate — Incorporate

D1414 (#3696, INC1–INC7): the flow at `/incorporate` that turns one of your
own projects, or a new one, into a company filed by Axal VC, built to the
owner's canvases `design/incoming/Incorporate Flow Page.dc.html` and
`design/incoming/Incorporate · Boards.dc.html`. `pages/IncorporatePage.jsx`
re-exports `IncorporateFlow.jsx`, so `App.jsx` and `LegalEnginePage.jsx` keep
their import.

| File | What it is |
|---|---|
| `IncorporateFlow.jsx` | The six steps (goals, compare, company details, review, pay & file, done), `?project=<id>` prefill, Start fresh, the device draft, the order and Stripe. |
| `IncorporationTimeline.jsx` | After payment: Submitted, Packet ready and Filed from the order's own row (D601), the EIN row (D579), and the company line only when the order carries `company_uid`. |
| `IncorporateDone.jsx` | "[Company] is on its way", Back to the project, Open company (only with `company_uid`), and the next steps: the 83(b) deadline and the cap table. |
| `incorporateModel.js` | Pure: the steps and their words, the recommendation, the jurisdiction card, your own projects, the prefill, the co-founder agreement's status, the timeline and the 83(b) line, the device draft. |
| `incorporateAdapter.js` | The seam to what is not on main: `orderCompany` (#3855, the order's `company_uid`) and `askPanel` (#3706). |

## The rules for adding here

- **Only your own projects.** The picker reads `GET /api/account/projects`
  and keeps the owner's seat. Never `GET /api/projects`, which answers every
  venture to an investor or an Operating Partner.
- **The price is the catalog quote's one amount** (owner Q5), with the
  registered-agent offer beside it and "The state fee is confirmed at
  filing." No itemised breakdown is invented.
- **No gate and no bank link** (owner Q6, Q7).
- **A company appears when the order says so** (owner Q9): Open company and
  "now appears in Portfolio" are drawn only from `company_uid`, through
  `incorporateAdapter.orderCompany`.
- **Ask draws nothing until #3706's panel exists**, and no field trigger is
  drawn; never on the legal name, identity numbers or signatures.
- **The device draft is a convenience.** Every `localStorage` read and write
  is in try/catch, and a store that throws still lets the flow go on.
