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
| `reflectionsModel.js` | D7118 part 2: Today, This week and This month as pure rules: each period's date in the member's calendar, its state (○ Not yet, ✓ Saved, Couldn't be read), the questions per period in the Worker's keys, the save body (revision, request id), the month's two prompts in one text, and what a failed save says. No React. | — |
| `Reflections.jsx` | D7118 part 2 (canvas `Wellness Member Home`, WLM-01B, WLM-03): the three period cards on the home and one period's view (editor, private history with Edit reflection and Delete, the month's summary, earlier check-ins, Export). Reads and writes `wellbeingReflectionsApi`. The header heart (`frontend/src/components/FounderWellbeingMenu.jsx`) reuses its editor. | `/wellbeing?period=today\|week\|month` |
| `WellnessPresentationPage.jsx` | The public, signed-out Wellness presentation (D7121, PGW01–PGW03), in the public site's frame. Reads nothing live. Registered by `frontend/src/routes/programsWellness.jsx`. | `/programs/wellness` |
| `wellnessPresentation.js` | That page's map entry (key, page, PDF path, availability, edition) and every word it shows. No React, no API. | — |
| `wellnessPresentation.css` | That page's styles, scoped under `.pgw-page`; light only, as the public site is. | — |

## Rules

- **What the Worker stores decides what is drawn.** `cloudflare-worker/src/routes/wellbeing.ts` keeps a
  check-in as one row per day with six optional scores; the canvas's support and
  decisions are drawn as "Not recorded", and "one per week" is kept by re-saving
  onto this week's day. D570 lists every such gap with its route.
- **A booking carries no note, and no screen shows one** (D331). The booking body
  is `bookingPayload()`, and the expert's list never renders `booker_note`.
- **Eadwyn reads counts, never wellbeing data.** Each rail's coverage comes from a
  builder in `wellbeingModel.js` that takes only counts, because coverage lines are
  sent to a model on a read-back.
- `frontend/test/wellbeing_d570.test.mjs` pins all of the above.
- **Each reflection period is its own record (D7118).** A day's save never touches the week or the month; the page keeps the draft on a failed save and never shows a day without an entry as a 0. `frontend/test/wellbeing_reflections_7118.test.mjs` pins it.
- **The public presentation shows no one.** `/programs/wellness` names no expert, member, session or entry, and links the workspace only through sign-in; `frontend/test/wellness_presentation_d7121.test.mjs` pins that, the PDF href and its content type.
