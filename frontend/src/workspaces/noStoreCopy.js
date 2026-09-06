/**
 * The no-store copy a zone renders, in one place both its page and its bucket
 * board read.
 *
 * WHY IT MOVED HERE. `BucketOverview` already derives its "Not built" line from
 * the same object the zone page renders, through `unbuiltFrom()`, so a card can
 * never describe a store the page denies having. A board section needs the same
 * guarantee, and it was briefly implemented by passing the object in as an
 * argument — which put the coupling in the caller, where a guard cannot see it,
 * and where forgetting the argument silently produced a section with no gap and
 * no source at all.
 *
 * Importing one exported object from both sides makes it structural instead:
 * there is one sentence, and neither surface can be gentler than the other
 * because neither has its own copy to soften.
 *
 * Plain JavaScript, no JSX, so `bucket_board.test.mjs` can load it in Node —
 * `AdvisorBucketRoutes.jsx` cannot be loaded there.
 */

/** Advisor `/expertise` — the one zone of that bucket with nothing behind it. */
export const ADVISOR_EXPERTISE_COPY = {
  visibility: {
    heading: 'Nothing counts profile views',
    what: 'How often your profile was shown, how often it was opened, and which searches you appeared in.',
    why: 'There is no impression or profile-view counter anywhere in the product — not for advisors, not for anyone. This needs an analytics pipeline rather than a table, and a page of plausible-looking numbers would be worse than an empty one.',
    links: [{ to: '/expertise/profile', label: 'What a founder would see →' }],
  },
};

/** Keyed by bucket prefix, matching the shape `AdvisorBucketRoutes` reads. */
export const ADVISOR_COPY = {
  '/expertise': ADVISOR_EXPERTISE_COPY,
};
