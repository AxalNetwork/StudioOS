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

/**
 * Network · Organizations, on a licence that has no store for it.
 *
 * `ORG_BACKED` in `NetworkWorkspace` is `{founder, investor}`: a founder reads
 * `contacts.organization` and the investor workspace has its own section, while
 * an advisor is 403'd from `/api/contacts` and an operator's NetworkPage has no
 * organizations tab at all. The heading is the exact line the overview card has
 * always shown, so the card, the board section and the rail say one thing.
 */
export const NETWORK_ORG_COPY = {
  heading: 'Organizations reads nothing on this licence — no store links a relationship to an organisation here.',
  what: 'The companies, funds and firms behind the people you know, rolled up from the relationships you keep.',
  why: 'The roll-up needs a person-to-organisation edge, and on this licence there is none: an advisor cannot read the contact store at all, and an operator has no organizations surface to roll up from. A count assembled from anything else would be counting something other than what the heading says.',
};

/**
 * Research · Client prep, until a founder can grant an advisor their record.
 *
 * Half of a client brief already exists — the topic and questions the client
 * wrote when they asked for the session. The other half is the client's own
 * project record, which is closed by rule rather than absent. Task #55.
 */
export const RESEARCH_CLIENT_PREP_COPY = {
  heading: 'The client brief is not built yet',
  what: 'One client per brief: what they asked for, what the engagement record says, what changed on their side, and what is still open.',
  why: 'Half of it exists: a session request already carries the topic and the questions the client wrote themselves when they asked for it. What is missing is the client\'s own record — and not for want of a join. A client\'s account carries their founder id and a project carries the same id, which is the very column the founder-data guard reads before it decides, so what stands in the way is an access decision, not an absent table. Which decision it is depends on who is reading; the note above says which applies to you. A brief assembled from one side only would be half a brief presented as a whole one.',
};
