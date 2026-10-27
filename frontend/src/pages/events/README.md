# Events: host tools and member/public detail

`EventManagePage.jsx` draws the Ops canvas eligibility, registration queue,
agenda editor and check-in (D1036) at the four manage routes, under the shared
host header. `HostHeader.jsx` is that header for the editor and every manage
tab (MEV12a), with `NewEventHeader` for `/events/new` (MEV12b); its tabs are
literal links, Check-in only on the event's day. `hostHeaderModel.js` holds its
pure rules: the event's day in its own zone, the time line, the publish gate,
the one primary action, Registrations' count, and MEV13's waiting words. It reads
through the authenticated `events` client; host/admin authority stays in the
Worker. `eventOrganiserModel.js` contains tab, pagination and missing-value
formatting shared with the member registration panel. Failed reads are
Unreadable, never a zero count. `eventOrganiser.css` owns only these cards.

`PublicEventDetailPage.jsx` retains public registration and paid checkout and
shows the signed-in member's own registration. Signed-in numeric event paths
use the authenticated detail endpoint; public slug paths use the public reader.
`MyEventsPage.jsx` is My events (D1030, #2387): on a desktop, Upcoming, Hosting, Discover and Past at `/my/events`, `/hosting`, `/discover` and `/past`, built from the pure `myEventsModel.js` (the tabs, a place in the canvas's words, the groups, Past and the counts); a failed read is never "none". Below 1024px (D1037, #2878) the same tabs sit under the account `PhoneBar`: `MyEventsPhone.jsx` draws MEV18a's Upcoming (the week strip, the next event, Going as cards) and MEV18c's check-in sheet, the pure `myEventsPhoneModel.js` their rules and words, and `myEventsPhone.css` the 44 × 44px targets under `my-events-phone`; the ticket is a full-screen page (MEV18b), and D700's A7m view is retired. `/my/events/ticket/:id` and `/my/events/hosting/:id` draw the ticket and hosted-event drawers over their tab (D1035, #2876; the shared right-side `Sheet` since D1317): `MyEventsDrawers.jsx` holds the drawers, the publish and cancel dialogs and MEV17's cards, and the pure `eventDrawersModel.js` every rule and line they say. D1034 (#2875) completes the four tabs: `MyEventsTabs.jsx` draws Needs you, the month calendar and Month view, Subscribe, Hosting's counts, filters, menu and pages, Discover's chips, filters and actions, Past's chart, filters and years, and the states, and makes no read of its own (the page passes its reads in); the pure `myEventsTabsModel.js` holds every rule and word they use.

`eventTimeModel.js` (D1115) formats saved instants in the event’s own zone and
preserves unchanged seconds/DST occurrences; new local values are converted by
the existing Worker writer. `EventEditorPage.jsx`
reads the detail envelope’s `event` and audience rules, and refuses an edit when
the detail is unreadable. A draft or sent-back event offers one action (D1031): "Publish"
when unlisted or private, "Send for review" when public. Its words come from
`publishAction` in `eventOrganiserModel.js`, and it opens a dialog that says
what happens and who is told before it saves. The manage page's audience roles
equal the Worker's `EVENT_ROLES`, advisor included. Agenda is managed separately. Tickets use `reg_status`,
the member’s own stored check-in code and `comp` flag; member calendar links use
the authenticated numeric-ID route. `PublicEventsPage.jsx` is the public Programs & Events page (D679): the
Spin-Out Lab's open cohort, read from `frontend/src/lib/spinoutLab.js`, above the public
event feed with its filters, archive, paging and calendar file.


D1131 (#3011) adds the next-event presenting and recorded seat-source pills,
the timed Join control, actual suggestion eligibility and its own retry state,
event-day Check in on desktop Hosting/Hosting soon, and Events' account-menu
Current marker. `eventTime.js` shares UTC timestamp parsing and event-zone day
rules with `hostHeaderModel.js`; `myEventsModel.js` holds the join boundary,
source words and promotion-row projection. Migration 611 stores both facts on
the registration when they happen (`comp_source`, `promoted_at`); a row from
before it holds NULL, read as Source not recorded and no off-waitlist row, so
no historical source or promotion is guessed. See `design/EVENT_SYSTEM.md` §10 for the surface's current
scope and the parts still pending. Calendar cancellation cleanup is the Worker's
`cloudflare-worker/src/routes/_eventCalendar.ts` / `cloudflare-worker/src/services/calendar/cancelEvents.ts`, not a client-side provider call.

D1131 cleanup uses the existing CF/D1 job queue: two immediate copies, bounded
continuation, independent provider retries and a fresh cancellation check on
delivery. Its queue contract is in `cloudflare-worker/src/services/queueWorker.ts`
and `cloudflare-worker/src/models/jobs.ts`; no new schema or binding is needed.
