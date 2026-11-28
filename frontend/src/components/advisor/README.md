# components/advisor — Eadwyn's chat, its question widget and their pieces

Eadwyn AI is the Studio assistant; these files draw it. The filenames keep the
old "advisor" name, the copy does not (see `PersonalAdvisor.jsx`'s header).

| File | What it is |
|---|---|
| `PersonalAdvisor.jsx` | The chat: bootstrap and history, the transcript and its bubbles, the composer, the tutor, the fullscreen view and the phone frame. |
| `StudioInterview.jsx` | What every Studio home mounts: the full chat while the interview is open, one collapsed row once it is complete (D324). |
| `interviewCompleteRow.jsx` | That collapsed "interview complete" row (D324). |
| `AdvisorProgressWidget.jsx` | The question widget's Proposed, Pending and Completed buckets, from `/advisor/queue` and `/advisor/answered`. |
| `AdvisorFilledBanner.jsx` | The page banner naming the fields Eadwyn filled on this page, with Review. |
| `EadwynPanels.jsx` | The chat's Tasks and My tickets tabs. |
| `eadwynPhone.jsx` | The phone pieces (D701), importable by a Node test. |
| `transcriptPieces.jsx` | D9288: the unreadable notice with Retry and the tool-turn preview, importable by a Node test. |

The rule for adding here: `PersonalAdvisor.jsx`, `StudioInterview.jsx` and
`AdvisorProgressWidget.jsx` reach `../../lib/advisor/router.js`, which a Node
test cannot import, so a piece a test must render goes in a module that does
not (`eadwynPhone.jsx`, `transcriptPieces.jsx`), and pure rules go in
`../../lib/advisor/`. A failed read says it failed and offers Retry; it never
draws the empty state of the thing it could not read (D9288).
