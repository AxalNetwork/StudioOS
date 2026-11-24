### Introduction requests (#7673)

No page or canvas is implemented here; the member and operator screens follow the approved Network
canvases in a later change. All routes are mounted under `/api/intro-requests` by
`routes/intro_requests.ts` (service `services/introductionRequests.ts`).

| Route | Gate | Purpose |
| --- | --- | --- |
| `GET /readiness` | signed in | The active policy and the caller's requirements, each missing, awaiting review, rejected, expired or met |
| `PUT /readiness/:key` | signed in, not support | Save one requirement; a change returns it to review |
| `POST /provisional-targets` | signed in, not support | Name a person who is not in the directory yet |
| `GET /` | signed in | The caller's requests, with a true total and a cursor |
| `POST /` | signed in, not support | A draft, idempotent on the caller's key |
| `GET /:uid` | owner | One request in the requester's projection |
| `PATCH /:uid` | owner, not support | Edit a draft, or a request Axal asked to add to |
| `POST /:uid/submit` | owner, not support | Check readiness from stored reviews; queue it or say what is missing |
| `POST /:uid/withdraw` | owner, not support | Withdraw; contact history is kept |
| `GET /operator/queue` | HQ admin | Submitted requests by state, next actor or own assignment |
| `GET /operator/readiness` | HQ admin | Requirements awaiting review |
| `POST /operator/readiness/:userId/:key` | HQ admin | Approve or reject; never one's own |
| `GET /operator/provisional-targets` | HQ admin | Provisional people by review status |
| `GET /operator/requests/:uid` | HQ admin | One request in the operator's projection |
| `POST /operator/requests/:uid/assign` | HQ admin | Take a submitted request |
| `POST /operator/requests/:uid/move` | assigned operator | One allowed state change |
| `POST /operator/requests/:uid/recipient` | assigned operator | Name the directory person for a provisional or organisation-only request |
| `POST /operator/requests/:uid/contact-attempts` | assigned operator | Record a contact the operator made |
| `POST /operator/contact-attempts/:attemptUid/reconcile` | assigned operator | Settle an attempt as delivered or failed |

No route sends a message. Every state-changing write carries the revision it changes. See D7673.
