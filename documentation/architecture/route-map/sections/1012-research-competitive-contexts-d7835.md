### Research competitive contexts (#7835, D7835)

No page or canvas is implemented here; the form is #7851 and the run that takes a
context is #7837. Every route is mounted under `/api/research/competitive-contexts`
by `routes/research_competitive_contexts.ts`, signed in and owner-private (another
member's context is a 404). A support session reads but cannot write. Client:
`frontend/src/lib/api/researchCompetitiveContexts.js`.

| Route | Purpose |
| --- | --- |
| `GET /` | The caller's contexts, newest first |
| `POST /` | Save a new context (version 1) |
| `GET /:uid` | One context; a directory record is named only while it is served to the caller |
| `PUT /:uid` | Replace it, naming the version read; a stale version is 409 with the current version |
| `DELETE /:uid?version=N` | Delete it, naming the version read |
| `GET /:uid/versions/:version` | A saved version exactly as it was |
