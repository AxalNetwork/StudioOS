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
`MyEventsPage.jsx` is My events (D1030, #2387): on a desktop, Upcoming, Hosting, Discover and Past at `/my/events`, `/hosting`, `/discover` and `/past`, built from the pure `myEventsModel.js` (the tabs, a place in the canvas's words, the groups, Past and the counts); a failed read is never "none", and the phone keeps D700's A7m sections. `EventEditorPage.jsx`
reads the detail envelope’s `event` and audience rules, and refuses an edit when
the detail is unreadable. Agenda is managed separately. Tickets use `reg_status`,
the member’s own stored check-in code and `comp` flag; member calendar links use
the authenticated numeric-ID route. `PublicEventsPage.jsx` is the public Programs & Events page (D679): the
Spin-Out Lab's open cohort, read from `frontend/src/lib/spinoutLab.js`, above the public
event feed with its filters, archive, paging and calendar file.
