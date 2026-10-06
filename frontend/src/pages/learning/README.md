# frontend/src/pages/learning — the Learning center (D562)

Every Learning route renders `LearningPage.jsx`, with one `view` per route. The
routes live in the D528 module `frontend/src/routes/learning.jsx`, which
`App.jsx` composes. The user menu's "Learning" opens `/learning`.

## What lives here

| File | What it is |
| --- | --- |
| `LearningPage.jsx` | The routed page: the gate, then the view's container. Every view is wired since stage 3; a profile the gate holds sees the coming-soon card in place. |
| `LearningHome.jsx` | `/learning`: the tabs, the search, Continue learning, My programs, Upcoming webinars and the live reads, plus `LearningHomeView`, which draws it all from props. |
| `LearningWired.jsx` | The learner pages that read the Learning store: a course, a lesson, a standalone video or reading, and My learning. Each is a pure view plus the container that reads for it. |
| `LearningStudio.jsx` | `/learning/studio`, the Super Admin's: the content table (exercises and exams included), the webinar list, and the editor the address opens (`?item=`, `?course=`, `?exercise=`, `?exam=`, `?webinar=`, `?new=`). |
| `StudioItemEditor.jsx` | Creates and edits a video (a link or an uploaded file) or a reading, with publish, unpublish and archive. |
| `StudioCourseBuilder.jsx` | A course's fields and resources, its modules and its lessons: add, edit, delete, and reorder with up and down. |
| `videoUpload.js` | The pure half of a video's upload (D561): the route's limits, the check made before anything is sent, and the upload field's states. `uploadVideo` in `studioActions.js` makes the calls. |
| `LearningPrograms.jsx` | The assigned admin's `/learning/programs` and `/learning/programs/:program` (D558): read-only, each enrolled member against the program's content. |
| `ProgramStudio.jsx` | The Super Admin's `/learning/studio/programs` and `/learning/studio/programs/:program`: a program's fields, status, content, admins and members. |
| `MyPrograms.jsx` | The home's My programs: the member's programs with their progress, and the ones open to join. |
| `programModel.js`, `programReads.js` | Programs' pure half, and every program call. |
| `LearningAssessments.jsx` | Exercises and exams (D559): their pages, the card an exercise or exam lesson shows, the studio's container for them, and the read-only review of learners' work. |
| `StudioAssessmentEditors.jsx` | The studio's exercise editor and exam builder, and the submissions and attempts reviews, drawn from props. |
| `assessmentModel.js`, `assessmentReads.js` | Exercises' and exams' pure half, and every call for them. |
| `LearningWebinars.jsx` | Webinars (D560): the webinar page, the Webinars tab's two lists and the home's Upcoming webinars. |
| `WebinarStudio.jsx` | The Super Admin's webinars: schedule, publish, cancel, the recording and attendance, and the list. |
| `webinarModel.js`, `webinarReads.js` | Webinars' pure half (times in the viewer's zone, seats, the join note), and every webinar call. |
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
  fetches nothing. It draws four states: loading, empty, "Not recorded" (no
  route serves it, or the route does not send the field) and "Unreadable"
  (the read failed). The shape each one takes is in its docblock, from the
  backend issue that stores it, and every one is wired: #1158 for courses,
  lessons, items and progress; #1159 for programs; #1160 for exercises and
  exams; #1161 for webinars; #1162 for a video's upload and playback.
- **Wiring a surface means passing it data, not rewriting it.** A container
  reads through one of the files below and hands the component the state; the
  component does not change shape.
- **Five files call the client:** `learningReads.js`, `studioActions.js`,
  `programReads.js`, `assessmentReads.js` and `webinarReads.js`. They call
  only methods the client already has (`frontend/src/lib/api/learning.js`,
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
