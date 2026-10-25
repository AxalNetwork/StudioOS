# Community

D930 (#2367): Admin › Community at `/admin/community`, built to the owner's
"Community overview" canvas (CM1–CM13, `design/incoming/Community Page.dc.html`).
`/admin/held/community` redirects here through `HeldCommunityRedirect.jsx`, which
keeps the query and hash and adds `?moved=held-community` for CM13's notice.

- `AdminCommunity.jsx` — the page: header, scope chip, the period control
  (`?weeks=4|12|52`, 12 by default, D933), eight tiles, the cards, the two
  "Not recorded" figures and the consoles strip. It mounts its own
  `WorkerRail` in a `RailFrame`. The Recent activity card makes its own read
  of D932's activity, so a filter chip reads only that card again.
- `communityModel.js` — pure. Turns the seven reads into tiles and cards, each
  `ready`, `loading`, `unreadable` or `unrecorded`; the copy the canvas fixes;
  D915's Guard G for seats taken. D933 (#2717) adds the Community read's
  blocks (D931): the period tiles and their deltas, the weekly chart and its
  table, the funnel and events by type, who takes part, wellbeing, and the
  waits in Needs a decision.
- `HeldCommunityRedirect.jsx` — the old address.
- D934 (#2718), the four lightboxes (CM3–CM6), opened from the cards or by
  `?open=events|jobs|circles|activity`:
  - `CommunityLightbox.jsx` — the shell they share. It is a `Lightbox` that
    becomes the page below 1024px, and it holds the toolbar, the pager, the
    table or phone list, and each lightbox's own read.
  - `EventsLightbox.jsx` — CM3, D918's paged list.
  - `JobsLightbox.jsx` — CM4.
  - `CirclesLightbox.jsx` — CM5.
  - `ActivityLightbox.jsx` — CM6, D932's activity read.
  - `lightboxModel.js` — pure. The addresses, the search, filters, sorts and
    25-row pages, and the Events and activity queries.

The charts are D893's (`../../../ui/Charts.jsx`): one palette, and
only violet changes in dark mode.

D923’s Partner invitations door is retained in the consoles strip when the old
Community landing is retired. It has no pending queue; no count is invented.

## Rules

- Every figure comes from a read that exists today (D930 §2, D933), and each
  read answers alone; so does each block of the Community read. A block that
  could not be read says so, and one no store records says "Not recorded".
  It is never a zero and never a sample.
- The check-in band is a range of founders, withheld under seven. No mood or
  stress figure is drawn here.
- The events analytics read is drawn only under Guard G. Its `summary` is all
  time and never feeds a figure here.
- Counts only. The roster read carries names; the page keeps the kind and
  whether a row is active, and drops the rest at the read.
- Nothing is decided here. "Review" and every door open the console that
  decides, and each door is a literal `Link`, so the reachability walk finds it.
- The wellbeing aggregate is never called from this page. It decrypts members'
  answers to compute averages, and this page needs no average (D930 §2).
