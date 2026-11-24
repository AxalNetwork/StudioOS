### Formation case requests, the founder's side (#6695, E10 of #6680)

No page or canvas is implemented here. Mounted at `/api/formation/case-requests` by `cloudflare-worker/src/routes/formation_requests.ts`; every route is signed in and scoped to the caller's own cases.

| Route | Purpose |
| --- | --- |
| `GET /` | The requests asked of the founder on their own cases; `?case=<uid>` narrows to one case |
| `GET /:uid` | One of those requests; another subject's reads as 404 |
| `POST /:uid/answer` | The founder answers: text, a stored document of the case, or the bound hash of an approval; identity takes no file |
| `GET /cases/:caseUid/timeline` | The case timeline rows of visibility `all` |

HQ's and partners' writes are #6698's and #6711's, through `services/formationRequests.ts`. See D6695.
