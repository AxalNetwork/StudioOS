# `pages/wellbeing` — the Wellbeing screens (D570)

Built to `design/incoming/Ops Page.dc.html` (`wb-home`, `wb-book`, `wbx-practice`,
`wba-library`). Two of the four screens are older pages, extended rather than
duplicated, so they live one folder up: the member home is `../WellbeingPage.jsx`
and the expert's practice is `../ExpertEditorPage.jsx`.

| File | What it is | Route |
| --- | --- | --- |
| `wellbeingModel.js` | Every derivation the screens make: the check-in body, this week's entry, past weeks, slots, the availability grid, the library's filters, and the rails' coverage lines. No React. | — |
| `WellbeingParts.jsx` | The shared pieces: page head, card head, score dots, sparkline, step chips, "Not recorded" with its reason. | — |
| `WellbeingBookPage.jsx` | Book an expert in four steps. No rail, as the canvas draws none. | `/wellbeing/book` |
| `PracticeZones.jsx` | The practice's three zones: services, the weekly grid, upcoming bookings. Bodies only; `ExpertEditorPage.jsx` reads and writes. | `/wellbeing/practice` |
| `WellbeingResourceLibrary.jsx` | The admin resource library: list, publish, delete. | `/admin/wellbeing/resources` |

## Rules

- **What the Worker stores decides what is drawn.** `routes/wellbeing.ts` keeps a
  check-in as one row per day with six optional scores; the canvas's support and
  decisions are drawn as "Not recorded", and "one per week" is kept by re-saving
  onto this week's day. D570 lists every such gap with its route.
- **A booking carries no note, and no screen shows one** (D331). The booking body
  is `bookingPayload()`, and the expert's list never renders `booker_note`.
- **Eadwyn reads counts, never wellbeing data.** Each rail's coverage comes from a
  builder in `wellbeingModel.js` that takes only counts, because coverage lines are
  sent to a model on a read-back.
- `frontend/test/wellbeing_d570.test.mjs` pins all of the above.
