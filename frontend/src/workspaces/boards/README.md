# Board registries

One file per bucket root the canvas corpus actually composes. `index.js` keys
them `role:prefix` and `boardFor(role, prefix)` resolves one; a root with no key
falls through to `BucketOverview`'s card grid, which is how founder and investor
keep theirs without a condition anywhere naming them.

## What is here

| File | Role |
| --- | --- |
| `index.js` | The `role:prefix` → factory table, and `boardFor()`. |
| `format.js` | Shared formatters. Two money helpers that are **not** interchangeable: newer stores hold integer cents, while `founder_needs.budget_*` and `quotes.price` are grandfathered REAL dollars. `count()` returns null for a figure that is not there, so `summary()` drops that half rather than printing a zero. |
| `partnerPipeline.js` | P3 — leads, proposals, negotiations, retainers, analytics. |
| `partnerDelivery.js` | P4 — board, deliverables, capacity, status reports, health. |
| `partnerOffers.js` | P5 — catalog, perk deals, visibility, proof, audience fit. |
| `advisorPractice.js` | V3 — opportunities, engagements, delivery, sessions, earnings. |
| `advisorExpertise.js` | V4 — profile, services, proof, thinking, and Visibility as a gap. |
| `network.js` | P6 and V5, one factory for both licences. The role decides only whether Organizations has a store. |
| `research.js` | P7 and V6. Both artboards draw two sections; Ask, Markets and Companies are link cards because the design drew no section for them. |

## The rule for adding to it

A registry is a **factory of `role`** returning `{ sources, sections }`.

- `sources` maps a key to a zero-argument fetch. Use the endpoint the zone page
  already calls — never a new aggregate route. The honesty rule in this product
  lives in the worker next to the absence (`partner_offers.ts` returns
  `views: null` beside `views_note`; `partner_pipeline.ts` returns
  `mrr_cents: null` beside `mrr_basis`), so reading the same endpoint makes the
  overview's number the zone's number and its caveat the same sentence.
- `sections` is **one entry per zone of the bucket, in zone order**. A zone the
  artboard drew no section for takes `kind: 'card'`; composing a section the
  design never drew is the same offence as inventing a number.
- A section declares a `source` **or** a `gap`, never both and never neither.
  A `gap` is the same object the zone's own page renders — imported, not
  retyped, so a board can never be gentler than the page behind it.
- `summary`, `rows` and `footnote` receive the source payload as their **only**
  argument. They must close over nothing: that signature is what makes it
  impossible for a gapped section to print a count.
- **No digit in any string.** Every canvas hardcodes its figures ("3 inbound ·
  1 expires tomorrow"); those are the designer's placeholders. Counts come back
  from `summary(payload)` or they do not appear.
- Plain JavaScript object literals, no JSX.

`frontend/test/bucket_board.test.mjs` fails the build on each of these.
