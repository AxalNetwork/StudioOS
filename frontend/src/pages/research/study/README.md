# frontend/src/pages/research/study — the market study (D7729)

<!-- index: none -->

The Study tab of a Research Project (`/research/projects/:uid/study` and
`/research/projects/:uid/study/:section`), built to the
`Research Markets Market Study` canvas (D7703 part 2, boards RST-00 to RST-18).
The study itself is one record per project with its customer segments, read
and written through `frontend/src/lib/api/researchStudies.js` (D7719).

What lives here:

- the frame: the section list (a phone sheet below 1024px), the study home,
  None for a project with no study, the read's failed state, and the
  section loader;
- the pure readings the frame and its sections share (sections, limits,
  drafts and bodies, the venture link, the origin in words);
- the pieces the sections and My Research's New research form share (the
  "Started from" lines, the Overview texts shown read-only);
- `sections/`, one file per section of the study.

## The rule for adding a section

The study has seven sections, in this order, each named by its file under
`sections/` as `<Name>.jsx`, the names being `ScopeAndQuestions`,
`CustomersAndDemand`, `SizeAndScenarios`, `CompetitionAndPricing`,
`EntryAndRisks`, `EvidenceAndFindings` and `ReportAndMonitoring`. The order, the labels
and the address slugs are fixed in the studyModel module's `STUDY_SECTIONS`.

A section whose file exists is built and mounted; one whose file is absent is
drawn as "Not built yet". The frame's loader is one
`import.meta.glob('./sections/*.jsx', { eager: true })`, the one shape the
node test loader expands (`frontend/test/_importMetaGlob.mjs`). So a section
issue adds its file and edits nothing shared: no route line (the route is one
`:section?` route in `frontend/src/routes/researchProjects.jsx`), no tab, no
list here.

A section file's default export is the section. It receives
`{ projectUid, project, data, archived, replace, retry }`: `data` is the study
read (`{ study, venture, segments, archived_segments }`, `study: null` for a
project with none), `replace` puts a saved answer (the Worker's whole study
read) in its place, and `retry` reads again. An archived project is read-only
in every section; a refusal is shown in the Worker's words.

Built so far: `frontend/src/pages/research/study/sections/ScopeAndQuestions.jsx`
(the Scope half; its questions are #7730).
