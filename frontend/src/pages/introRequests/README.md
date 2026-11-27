# frontend/src/pages/introRequests — introductions through Axal, the member side

<!-- index: generated -->

A member of any licence asks Axal to introduce them to a person: someone in the shared Network directory, someone
they name who is not in it yet, or the right person at an organisation (D9068, #9068). Built to the approved canvases
`design/incoming/Network Requester Profile and Readiness Page.dc.html` (D7677) and
`design/incoming/Network External Introduction Requests Page.dc.html` (D7678), on the Worker's
`/api/intro-requests` (D7673) through `introRequestsApi` (`../../lib/api/introRequests.js`). The routes are
`frontend/src/routes/networkIntroRequests.jsx`. The operator and reviewer screens are #9069's and live elsewhere.

<!-- files:begin -->
<!-- files:end -->

## The rules for adding here

- **Readiness is the server's.** A page words the statuses `GET /readiness` answers and never decides a member is
  ready; a read that fails is Unreadable, which never counts as ready (`introRequestModel.js`, `aggregateReadiness`).
- **Nothing here contacts anybody.** Saving, submitting, answering and withdrawing only change the member's own
  request. Outreach is an Axal operator's recorded act.
- **A refused or failed write keeps what was typed,** and a lost answer is checked by reading the request, never by
  sending it again.
- **The requester's projection only.** No contact attempt detail, operator note or other member's data is read here.
