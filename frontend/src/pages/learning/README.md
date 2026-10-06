# frontend/src/pages/learning — the Learning center (D562)

Every Learning route renders `LearningPage.jsx`, with one `view` per route. The
routes live in the D528 module `frontend/src/routes/learning.jsx`, which
`App.jsx` composes. The user menu's "Learning" opens `/learning`.

## What lives here

| File | What it is |
| --- | --- |
| `LearningPage.jsx` | The routed page: the gate, then either a wired view's container or the header, rail and body of a view still waiting on its store. |
| `LearningHome.jsx` | `/learning`: the tabs, the search, Continue learning and the live reads, plus `LearningHomeView`, which draws it all from props. |
| `LearningWired.jsx` | The learner pages that read the Learning store: a course, a lesson, a standalone video or reading, and My learning. Each is a pure view plus the container that reads for it. |
| `LearningStudio.jsx` | `/learning/studio`, the Super Admin's: the content table, and the item editor or course builder the address opens (`?item=`, `?course=`, `?new=`). |
| `StudioItemEditor.jsx` | Creates and edits a video (a link) or a reading, with publish, unpublish and archive. |
| `StudioCourseBuilder.jsx` | A course's fields and resources, its modules and its lessons: add, edit, delete, and reorder with up and down. |
| `studioParts.jsx` | The studio's shared pieces: the fields, the error line that shows a route's refusal in its own words, the status actions and the archive confirmation. |
| `learningAccess.js` | `learningComingSoon()`, the temporary coming-soon gate (see below). |
| `learningModel.js` | The pure half: the tabs, the row mappers, how a video link plays, lesson order, lengths, and the derivations the components share. |
| `learningReads.js` | The learner's calls: the catalog, a course, an item, my record and "Mark complete" through `learningApi`, plus articles, publications and events. |
| `studioActions.js` | The studio's calls, through `adminLearningApi`, and the bodies its forms send. |
| `useLearningRead.js` | One read's state for a container: loading, ready, missing (a 404), unreadable, and a retry. |
| `LearningStates.jsx` | The frame, the header, and the states every surface draws, plus the coming-soon card. |
| `CourseOutline.jsx`, `LessonPlayer.jsx`, `WebinarPanel.jsx`, `ExercisePanel.jsx`, `ExamFlow.jsx`, `MyLearning.jsx`, `ProgramLearnersTable.jsx`, `StudioContentTable.jsx`, `ProgramsTable.jsx`, `ProgramDetail.jsx` | The presentational components, one per surface the canvas draws. |

## The rules for adding here

- **A surface is a component that takes the route's shape as props.** It
  fetches nothing. It draws four states: loading, empty, "Not recorded" (the
  store does not exist yet, or the route does not send the field) and
  "Unreadable" (the read failed). The shape each one takes is in its docblock,
  from the backend issue that stores it: #1158 for courses, lessons, items and
  progress (wired); #1159 for programs; #1160 for exercises and exams; #1161
  for webinars; #1162 for video playback from an upload.
- **Wiring a surface means passing it data, not rewriting it.** A container
  reads through `learningReads.js` or `studioActions.js` and hands the
  component the state; the component does not change shape.
- **Only `learningReads.js` and `studioActions.js` call the client**, and only
  through methods the client already has (`frontend/src/lib/api/learning.js`,
  `frontend/src/lib/api/adminLearning.js`, and the older ones in
  `frontend/src/lib/api.js`). No client method is added from here.
- **A refusal is shown in the route's own words.** The client's error carries
  the route's sentence; the page shows it as it came.
- **Never a fake row, never a zero for a missing value.** A field the route
  does not send reads "Not recorded".
- **The app's own styling.** The `ui/` kit and the Tailwind tokens; never the
  canvas's inline styles, and never a font.

## The coming-soon gate

`learningAccess.js` holds it, temporary, by the owner's request of
2026-10-06: every profile but the admin and the Super Admin sees "Coming soon"
everywhere in Learning except Articles. The gate is applied before a wired
view is mounted, so a gated profile never reads the Learning store. To lift
it, set `LEARNING_COMING_SOON` to `false`, then remove the gate and its
callers' coming-soon branches.
