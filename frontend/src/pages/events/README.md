# Events: host tools and member/public detail

`EventManagePage.jsx` draws the Ops canvas eligibility, registration queue and
agenda editor at the three manage routes, inside `WorkspaceShell`. It reads
through the authenticated `events` client; host/admin authority stays in the
Worker. `eventOrganiserModel.js` contains tab, pagination and missing-value
formatting shared with the member registration panel. Failed reads are
Unreadable, never a zero count. `eventOrganiser.css` owns only these cards.

`PublicEventDetailPage.jsx` retains public registration and paid checkout and
shows the signed-in member's own registration. Signed-in numeric event paths
use the authenticated detail endpoint; public slug paths use the public reader.
`MyEventsPage.jsx` lists hosted and attended events. `EventEditorPage.jsx`
edits event details. `PublicEventsPage.jsx` is the public event feed.
