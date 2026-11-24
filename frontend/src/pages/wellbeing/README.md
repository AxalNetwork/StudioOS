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
| `recommendationsModel.js` | D7119 part 2: the member's choices as a PUT body (only what changed, the revision, consent only with a source), card facts in words, what was not shown, and the Recommendations section's states. No React. | — |
| `WellnessSuggestions.jsx` | D7119 part 2 (canvas `Wellness Member Home`, WLM-04, WLM-05): the Recommendations section on the home (Why this?, Dismiss with Undo, View, Browse all) and Choose interests (kinds of support, formats, languages, a price limit, suggestions on or off, topic permission with its sources, Reset all). Reads and writes `wellbeingRecommendationsApi`; never reads the journal itself. | `/wellbeing` |
| `groupSessionsModel.js` | D7120 part 2: a group session's when (in the member's zone), seats as a count, what each state allows, the calendar choices, what a refused reservation or release says, and a My-seats row. No React. | — |
| `GroupSessions.jsx` | D7120 part 2 (canvas `Wellness Member Home`, WLM-07, WLM-07B, WLM-08): the seat panel (opened from a group suggestion's See seats) with what the facilitator and other members learn, a calendar choice and Reserve a seat, and My group seats with Release seat. Reads and writes `wellbeingGroupSessionsApi`; never an attendee list. | `/wellbeing` |
| `WellnessPresentationPage.jsx` | The public, signed-out Wellness presentation (D7121, PGW01–PGW03), in the public site's frame. Reads nothing live. Registered by `frontend/src/routes/programsWellness.jsx`. | `/programs/wellness` |
| `wellnessPresentation.js` | That page's map entry (key, page, PDF path, availability, edition) and every word it shows. No React, no API. | — |
| `wellnessDeck.js` | The five-slide Wellness deck as HTML (D7121 part 2, PGW04–PGW06), on the kit's slide master (`../programs/deck.js`). `scripts/build-wellness-brief.mjs` prints it to `frontend/public/program-briefs/axal-vc-wellness-v1.pdf`; the SPA never imports it. | — |
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
- **The public presentation shows no one.** `/programs/wellness` names no expert, member, session or entry, and links the workspace only through sign-in; `frontend/test/wellness_presentation_d7121.test.mjs` pins that, the PDF href and its content type, and that every page of the committed PDF carries exactly its slide's text. After changing a word in `wellnessDeck.js` or the page's purpose, audience or steps, rebuild the PDF with `node scripts/build-wellness-brief.mjs`.
