# Community model

#4717 package 6: the Community page's model, one module per domain. Every
module here is pure: it turns the Community read (D931,
`GET /api/admin/community/overview`) into what a card draws, and never fetches.
`../communityModel.js` is the front door. It re-exports exactly what it
always exported, so the page, the lightboxes and the tests import from one
place.

- `read.js` — reading the read: a block in its state (`blockOf`), the page's
  clock (`clockOf`), and the strict readers every builder uses (`countsAt`,
  `countMap`, `hoursOf`).
- `contract.js` — the read's contract: every block's fields, by kind, and
  `checkOverview(answer)`, which lists the paths that break it. The worker's
  real answer is held to it (`cloudflare-worker/test/community_contract_4717.test.ts`).
- `format.js` — words from figures: days, waits, deltas, seats, days open.
- `period.js` — the period control: 4, 12 or 52 weeks, 12 by default, the
  worker's default too.
- `constants.js` — the page's fixed words and numbers.
- `queues.js` — the two review queues, Waiting on you's counts, the oldest wait
  and Needs a decision.
- `events.js` — the Events card: show-up, Next up, the funnel, the waitlists,
  events by type.
- `jobs.js` — the Jobs card.
- `people.js` — circles and the roster.
- `activity.js` — the weekly chart, its sentence, and Who takes part.
- `wellbeing.js` — experts, bookings and the check-in band.
- `page.js` — the eight tiles, the consoles strip, and whether the page failed
  or is empty.

## The rules

- A module reads only through `read.js`. A count that is missing, a string,
  negative or fractional makes its part unreadable, never 0 (package 3).
- A list a card draws keys from comes from the module that draws it (the job
  statuses in `jobs.js`, the profiles in `activity.js`, the event types from
  `frontend/src/lib/eventTypes.js`), and `contract.js` imports the same list. So the
  contract and the page cannot disagree about what a map must carry.
- Nothing here imports React or the page. The worker's contract test imports
  `contract.js` and `period.js` directly.
- A new module is added to `../communityModel.js` only for what the page or a
  test imports, never for a helper.
