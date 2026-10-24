# Community

D930 (#2367): Admin › Community at `/admin/community`, built to the owner's
"Community overview" canvas (CM1–CM13, `design/incoming/Community Page.dc.html`).
`/admin/held/community` redirects here through `HeldCommunityRedirect.jsx`, which
keeps the query and hash and adds `?moved=held-community` for CM13's notice.

- `AdminCommunity.jsx` — the page: header, scope chip, the period control
  (drawn, and waiting for the Community read), eight tiles, the cards, the two
  "Not recorded" figures and the consoles strip. It mounts its own
  `WorkerRail` in a `RailFrame`.
- `communityModel.js` — pure. Turns the six reads into tiles and cards, each
  `ready`, `loading`, `unreadable`, `notyet` or `unrecorded`; the copy the
  canvas fixes; D915's Guard G for seats taken.
- `HeldCommunityRedirect.jsx` — the old address.

The charts are D893's (`../insights/InsightsCharts.jsx`): one palette, and
only violet changes in dark mode.

## Rules

- Every figure comes from a read that exists today (D930 §2), and each read
  answers alone. A block that waits for a part says "Not read here yet" and
  which part brings it. It is never a zero and never a sample.
- The events analytics read is drawn only under Guard G. Its `summary` is all
  time and never feeds a figure here.
- Counts only. The roster read carries names; the page keeps the kind and
  whether a row is active, and drops the rest at the read.
- Nothing is decided here. "Review" and every door open the console that
  decides, and each door is a literal `Link`, so the reachability walk finds it.
- The wellbeing aggregate is never called from this page. It decrypts members'
  answers to compute averages, and this page needs no average (D930 §2).
