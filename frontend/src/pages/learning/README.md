# frontend/src/pages/learning — the Learning center (D562)

Every Learning route renders `LearningPage.jsx`, with one `view` per route. The
routes live in the D528 module `frontend/src/routes/learning.jsx`, which
`App.jsx` composes. The user menu's "Learning" opens `/learning`.

## What lives here

| File | What it is |
| --- | --- |
| `LearningPage.jsx` | The routed page: the gate, then the view's container. Every view is wired since stage 3; a profile the gate holds sees the coming-soon card in place. |
| `LearningHome.jsx` | `/learning`: the tabs, the search, Continue learning, My programs, Upcoming webinars and the live reads, plus `LearningHomeView`, which draws it all from props. The owner requested no AI rail on this home page (desktop or phone); other Learning views keep theirs. |
| `LearningWired.jsx` | The learner pages that read the Learning store: a course, a lesson, a standalone video or reading, and My learning. Each is a pure view plus the container that reads for it. |
| `LearningStudio.jsx` | `/learning/studio`, the Super Admin's: the content table (exercises and exams included), the webinar list, and the editor the address opens (`?item=`, `?course=`, `?exercise=`, `?exam=`, `?webinar=`, `?new=`). |
| `StudioItemEditor.jsx` | Creates and edits a video (a link or an uploaded file) or a reading, with publish, unpublish and archive. |
| `StudioCourseBuilder.jsx` | A course's fields and resources, its modules and its lessons: add, edit, delete, and reorder with up and down. |
| `videoUpload.js` | The pure half of a video's upload (D561): the route's limits, the check made before anything is sent, and the upload field's states. `uploadVideo` in `studioActions.js` makes the calls. |
| `videoAnalyticsModel.js`, `VideoAnalyticsSheet.jsx` | D4181 (#4181, lr17): one video's analytics in the studio's right Sheet, opened by "Analytics" on a video's row of the content table. Views, completion rate, median watch time, and the drop-off over 20 spans of the video with chapter markers and the biggest drop. Under five viewers it says only "Not enough views to show"; a figure the route cannot give reads its reason, never 0. It reads only, and names no member. |
| `LearningPrograms.jsx` | The assigned admin's `/learning/programs` and `/learning/programs/:program` (D558): read-only, each enrolled member against the program's content. |
| `ProgramStudio.jsx` | The Super Admin's `/learning/studio/programs` and `/learning/studio/programs/:program`: a program's fields, status, content, admins and members. |
| `MyPrograms.jsx` | The home's My programs: the member's programs with their progress, and the ones open to join. |
| `MemberProgram.jsx` | `/learning/my-programs/:program` (D3726 LR13): one program as its member sees it, the curriculum with their progress, Continue, Join, and the enrolment card. |
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
| `StudioStreamParts.jsx` | #4177 (L2 of #3726): a stored video's file on Cloudflare Stream (lr14, lr14b, lr20e), and under it the thumbnail picker, the captions and the chapters editor (lr15). `StudioItemEditor` mounts it; see "Video on Stream" below. |

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
  `frontend/src/lib/api.js`). A client method is added only with its mounted
  route (#4178 added `learningApi.itemCaption` with `GET /api/learning/items/:uid/captions/:lang`).
- **A refusal is shown in the route's own words.** The client's error carries
  the route's sentence; the page shows it as it came.
- **Never a fake row, never a zero for a missing value.** A field the route
  does not send reads "Not recorded".
- **The app's own styling.** The `ui/` kit and the Tailwind tokens; never the
  canvas's inline styles, and never a font.

## The Stream lesson player (#4178, D4178)

`LessonPlayer.jsx` plays a ready Stream video in Stream's own player
(`@cloudflare/stream-react`, pinned exactly) on the signed source the item
read sends (`streamSourceOf`), so it can be timed and seeked. It starts at the
resume point and writes the position through `usePositionWriter`, the same
throttle as the uploaded-file player: at most every 15 s, and on pause.

- **Chapters** (`Chapters`) sit beside the player on a wide screen and below it
  on a tablet or phone. The current one is marked; a click seeks.
- **The transcript** (`Transcript`) reads a ready caption as timed cues
  (`readItemCaption` → `parseVtt`, which skips malformed cues), marks the
  current one, and seeks on a click. With no cues it shows the plain text and
  says why; a caption that cannot be read is said so, never an empty list.
- **A plain embed** (YouTube, Vimeo) cannot be seeked, so its chapters and
  transcript are text, not buttons.
- **The library's hover preview** (`HoverPreview` in `LearningHome.jsx`, lr7)
  reads the item once on hover (`readItemPreview`) and shows its signed
  `preview_url` when there is one; nothing otherwise.

## The coming-soon gate

`learningAccess.js` holds it, temporary, by the owner's request of
2026-10-06: every profile but the admin and the Super Admin sees "Coming soon"
everywhere in Learning except Articles. The gate is applied before a wired
view is mounted, so a gated profile never reads the Learning store. To lift
it, set `LEARNING_COMING_SOON` to `false`, then remove the gate and its
callers' coming-soon branches.


The Learning home now owns its gutters like Help: its decorative hero uses
`/site/home-hero.webp` with light/dark overlays, and its content has 16px/32px
insets. Desktop and phone render the same `LearningHero`; the phone frame's
optional header wraps its default bar, retaining Back, its subtitle and the
conditional Eadwyn control, with one heading. The temporary
coming-soon gate, links, searches and reads are unchanged.


## Video on Stream (#4177, L2 of #3726, on L1's routes, D4176)

- **Nothing is drawn before the routes answer.** A stored video's editor reads
  `GET …/items/:uid/stream` first. A 503 `stream_unavailable` (Stream not on)
  draws D561's R2 uploader in its place, with the route's sentence; any other
  failure is unreadable. The R2 uploader stays until L4 (#4179) has copied
  every R2 video. A new video still waits for its draft.
- **The 200 MB switch.** Up to and including 200 MB, `POST …/stream/uploads`
  answers a one-time `upload_url` and the file goes there by basic POST (XHR,
  for progress); above it, `tus-js-client` (pinned at 4.3.1, loaded only for
  such a file) goes through the Worker's tus route, and the session's headers
  reach only that creation request. A cancel or a failure abandons the video
  Stream made. While a video processes, the read is repeated every 10 s.
- **Under the field:** the thumbnail (a slider, the frame from the member
  read's signed poster, Use this frame), captions (Generate ▾ by language,
  Upload VTT, Delete asked first; "Only WebVTT files are accepted." before
  anything is sent) and chapters (times must increase, at most 100, saved by
  the item's PATCH; read from `GET /api/learning/items/:uid`, the only read
  that sends them).
- **The content table's Video column** reads Stream · Ready only when the item
  list carries `stream_uid`, which it does not yet; "None" is claimed only for
  `stream_uid: null`, else a video with no file or link is "Not recorded".
- **L4 is not built.** Copy to Stream, Copying…, Verified, "Copy failed · Try
  again" and the banner "[n] uploaded videos still play from storage." draw
  only when the list carries `stream_copy`, a name and shape guessed here
  pending #4179 (`videoUpload.js`), and the buttons only when the page passes
  `onCopyToStream`. No page does: there is no client method and no route for
  the copy yet, so today none of it is drawn.
- **The Ask triggers on a blank Title, Summary and Topic (#3706) are not
  wired here.** #3706's field triggers come from `GET /api/fills/sheet`, whose
  `FILL_FIELDS` has no Learning form, and the studio's rail has no page key;
  wiring them needs that Worker form first.
