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
- `page/` — the page's parts, split out of `AdminCommunity.jsx` (#4717
  package 6), with nothing to decide:
  - `parts.jsx`: its classes, a tile, a card, a part in its state, the console door;
  - `cards.jsx`: the cards;
  - `RecentCard.jsx`: Recent activity and its own read;
  - `useCommunityReads.js`: the page's one read, checked against its contract.
- `model/` — the model, one module per domain (its README).
- `communityModel.js` — the model's front door, re-exporting `model/`. Pure. Turns the Community read (D931) into tiles and
  cards, each `ready`, `loading`, `unreadable` or `unrecorded`; the copy the
  canvas fixes; D915's Guard G for seats taken. Since #4717 package 2 the page
  has ONE read: every figure and every row behind one (Next up, Needs a
  decision, most applications) is that read's, under its `as_of`. The Studio
  glance, the events and jobs lists, the analytics and the circles list are no
  longer read by the page; the lightboxes read what they list.
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
  - `lightboxModel.js` — pure. The addresses, the filters and sorts each
    lightbox offers, and the query each one sends. Since #4717 package 4 every
    lightbox reads one 25-row page from the Worker (Jobs and Circles from
    `GET /api/admin/community/jobs|circles`), and a search waits for the
    typing to stop.

The charts are D893's (`../../../ui/Charts.jsx`): one palette, and
only violet changes in dark mode.

D923’s Partner invitations door is retained in the consoles strip when the old
Community landing is retired. It has no pending queue; no count is invented.

## Rules

- Every figure comes from the Community read (#4717), and each of its blocks
  answers alone. If the read itself fails, the page says nothing is a zero and
  draws no figure; the consoles strip still works. In the Events card, Next up,
  the funnel and events by type each answer alone. A block that
  could not be read says so, and one no store records says "Not recorded".
  It is never a zero and never a sample.
- The read has a contract (#4717 package 6, `model/contract.js`). The
  worker's real answer is held to it in a worker test. The page checks every
  answer and sends the paths that break it to the error log, never a value.
- One default period: 12 weeks, on the page and in the worker (#4717 package 6;
  D931 had answered 4 when no `weeks` was given).
- By keyboard and touch (#4717 package 6, `community_a11y_4717`):
  - every button and link is at least 24px tall, and the period control and
    the chips 32px;
  - the period radio group moves focus with the choice (arrows wrap, Home, End);
  - no file takes the focus ring away.
- The read's shape is checked, never patched (#4717 package 3). A count that is
  missing, a string, negative or fractional, a map without a key the card
  draws, or a row without its title makes that part unreadable. No builder
  reads `Number(x) || 0`.
- The check-in band is a range of founders, withheld under seven founders.
  Other roles' check-ins are not counted toward it (#4717). No mood or stress
  figure is drawn here.
- The events analytics read is drawn only under Guard G. Its `summary` is all
  time and never feeds a figure here.
- Counts only. The roster is the Community read's `network` block, counted on
  the server over every row with archived rows out (#4717). The page reads no
  profile list, so no name can reach it and no capped list is counted.
- One clock. Days open, waits, Overdue and the next 30 days are measured from
  the Community read's `as_of` (`clockOf`), so Refresh moves them (#4717).
- Nothing is decided here. "Review" and every door open the console that
  decides, and each door is a literal `Link`, so the reachability walk finds it.
- The wellbeing aggregate is never called from this page. It decrypts members'
  answers to compute averages, and this page needs no average (D930 §2).
