# frontend/src/pages/learning — the Learning center (D562)

Every Learning route renders `LearningPage.jsx`, with one `view` per route. The
routes live in the D528 module `frontend/src/routes/learning.jsx`, which
`App.jsx` composes. The user menu's "Learning" opens `/learning`.

## What lives here

| File | What it is |
| --- | --- |
| `LearningPage.jsx` | The routed page: the gate, each view's header, the Worker AI rail, and the body for each view. |
| `LearningHome.jsx` | `/learning`: the tabs, the search and the three live reads, plus `LearningHomeView`, which draws it all from props. |
| `learningAccess.js` | `learningComingSoon()`, the temporary coming-soon gate (see below). |
| `learningModel.js` | The pure half: the tabs, the row mappers for the live routes, and the derivations the components share. |
| `learningReads.js` | The only file here that calls the client: articles, publications and events, through methods that already exist. |
| `LearningStates.jsx` | The frame, the header, and the four states every surface draws, plus the coming-soon card. |
| `CourseOutline.jsx`, `LessonPlayer.jsx`, `WebinarPanel.jsx`, `ExercisePanel.jsx`, `ExamFlow.jsx`, `MyLearning.jsx`, `ProgramLearnersTable.jsx`, `StudioContentTable.jsx`, `ProgramsTable.jsx`, `ProgramDetail.jsx` | The presentational components, one per surface the canvas draws. |

## The rules for adding here

- **A surface is a component that takes the planned API shape as props.** It
  fetches nothing. It draws four states: loading, empty, "Not recorded" (the
  store does not exist yet) and "Unreadable" (the read failed). The shape each
  one takes is in its docblock, from the backend issue that stores it: #1158
  for courses, lessons, items and progress; #1159 for programs; #1160 for
  exercises and exams; #1161 for webinars; #1162 for video playback.
- **Wiring a surface means passing it data, not rewriting it.** When a backend
  task merges with its client module, `LearningPage.jsx` reads through it and
  hands the component `status="ready"` and the rows. Until then the view draws
  `status="unrecorded"` with the line that says which store it waits on.
- **No client method is added from here.** Reads go through the methods in
  `frontend/src/lib/api.js` that already have a Worker route behind them.
- **Never a fake row, never a zero for a missing value.** A field the route
  does not send reads "Not recorded".
- **The app's own styling.** The `ui/` kit and the Tailwind tokens; never the
  canvas's inline styles, and never a font.

## The coming-soon gate

`learningAccess.js` holds it, temporary, by the owner's request of
2026-10-06: every profile but the admin and the Super Admin sees "Coming soon"
everywhere in Learning except Articles. To lift it, set
`LEARNING_COMING_SOON` to `false`, then remove the gate and its callers'
coming-soon branches.
