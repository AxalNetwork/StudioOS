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
| `itemisedQuoteModel.js` | D4357, pure: the review step's itemised quote, its Not recorded lines, each source and its day, and the total of the known lines. |
| `incorporateAdapter.js` | The seam to what is not on main: `orderCompany` (#3855, the order's `company_uid`) and `askPanel` (#3706). |

## The rules for adding here

- **Only your own projects.** The picker reads `GET /api/account/projects`
  and keeps the owner's seat. Never `GET /api/projects`, which answers every
  venture to an investor or an Operating Partner.
- **The price is the catalog quote's one amount** (owner Q5), with the
  registered-agent offer beside it and "The state fee is confirmed at
  filing." No itemised breakdown is invented.
- **The itemised quote is the Worker's** (D4357, #4357): the review step
  draws `GET /api/legal/incorporation/itemised-quote` line by line, each with
  its source and the day it was checked. An unknown fee reads "Not recorded",
  never 0, and the total of the known lines says so. No figure is typed here.
- **No gate and no bank link** (owner Q6, Q7).
- **No gate** (owner Q6). **The bank step** (#4356, D4356): the owner chose Mercury, which settles Q7. `BankStep.jsx` is "Open a bank account", a row after Filed on the timeline and a card in Done's next steps; done only when the founder's Mercury is connected and active. Open goes to `open_account_url` from `GET /api/mercury/personal/status`: the Worker builds it from the owner's referral link (`MERCURY_REFERRAL_URL`), else Mercury's public site. No file here names a Mercury host (D715).
- **A company appears when the order says so** (owner Q9): Open company and
  "now appears in Portfolio" are drawn only from `company_uid`, through
  `incorporateAdapter.orderCompany`.
- **Ask draws nothing until #3706's panel exists**, and no field trigger is
  drawn; never on the legal name, identity numbers or signatures.
- **The device draft is a convenience.** Every `localStorage` read and write
  is in try/catch, and a store that throws still lets the flow go on.
