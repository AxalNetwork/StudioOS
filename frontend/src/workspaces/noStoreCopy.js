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
 * Network · Organizations, on a licence that renders no body for it.
 *
 * `ORG_BACKED` in `NetworkWorkspace` is `{founder, investor}` and this file
 * used to explain that set as a store: "a founder reads `contacts.organization`
 * and the investor workspace has its own section". There is no such column on
 * `contacts`, and the investor path ends at `metadata.organization_name`, which
 * nothing in the product writes. The edge is missing on all four licences.
 *
 * What differs is only where the absence is said. Founder and investor have a
 * body that says it — an empty table, a stat reading "No organization fields
 * returned", and a header row of notes. Advisor and operator have no body, so
 * the copy below is the whole surface. The heading is the exact line the
 * overview card shows, so the card, the board section and the rail say one
 * thing.
 */
export const NETWORK_ORG_COPY = {
  heading: 'Organizations reads nothing on this licence — no store links a relationship to an organisation here.',
  what: 'The companies, funds and firms behind the people you know, rolled up from the relationships you keep.',
  why: 'The roll-up needs a person-to-organisation edge and nothing stores one: a relationship is a pair of account ids with a type, and a referral records an organisation as free text with no link back to an account. On this licence there is not even a surface to attempt it from — an advisor cannot read the contact store at all, and an operator has no organizations tab. A count assembled from anything else would be counting something other than what the heading says.',
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

/**
 * Research · Markets, Companies and Ask — blocked on a store, said where a
 * reader can see it.
 *
 * WHY THESE THREE ARE DIFFERENT FROM EVERY ENTRY ABOVE. The objects above
 * describe zones that render NOTHING ELSE: `unbuiltFrom` turns each into a
 * card, the page renders `NoStoreYet`, and the whole surface is the gap. These
 * three have live bodies and keep them. What is recorded here is narrower and
 * was previously written down only in `founderZoneFilters.js`, a table no
 * customer opens: each of these zones serves a real feed AND has a
 * canvas-specified capability with no store behind it.
 *
 * THE DISTINCTION IS THE WHOLE POINT, because collapsing it is how this gets
 * said wrongly in both directions. Saying "no store behind this yet" over
 * `/research/markets` is false — the signals feed is real, gathered on a
 * schedule, and the largest store in the product. Saying nothing is false too:
 * every filter the artboard draws for that zone is a view of a saved analysis
 * that no table holds, so a reader comparing the design to the page finds four
 * missing controls and no reason given. Both sentences are wrong; this is the
 * one that is not.
 *
 * `blocks` IS THE MISSING STORE, NAMED. It is the string the guard compares
 * against the filter registry's own reason for the same zone, so the sentence a
 * customer reads and the sentence a developer reads cannot drift apart — the
 * same coupling that put this whole file in one place.
 */
export const RESEARCH_STORE_GAPS = {
  markets: {
    eyebrow: 'Blocked on a store',
    blocks: 'a saved market analysis',
    heading: 'Signals are stored. A saved market analysis is not.',
    what: 'A deep-dive you ran and kept — its method, the date it was run, the documents it rests on, and whether it is current or retired.',
    why: 'Nothing saves a market deep-dive, so there is no analysis to keep, retire, build or list the sources of. The artboard makes this plain: its instrument table is Analysis · Method · Run · State, and all four filters it draws are views of that object. What this page reads instead is the signals feed, gathered on a schedule — real, populated, and a different object from the one the design narrows.',
  },
  companies: {
    eyebrow: 'Blocked on a store',
    blocks: 'a comparable, and a relation an analysis carries itself',
    heading: 'The analyses are stored. A comparable is not, and neither is an analysis-level relation.',
    what: 'Competitors filed as comparables, and saved analyses narrowed by the relation they describe.',
    why: 'No competitor can be filed as a comparable at all: the form offers direct or adjacent, and the row editor, the AI prompt and three server-side coercions all push anything else back to direct. The relation that does exist sits one level below what this header governs — `competitor_candidates` carries it per competitor, while this row narrows the saved analyses, and an analysis carries no relation of its own. The analyses store is real and readable; whether it holds any is a separate question from whether it exists.',
  },
};

/**
 * `ask` WAS THE THIRD ENTRY AND IS GONE, WHICH IS THE OUTCOME THIS OBJECT IS
 * FOR. It read "Answers are produced. Nothing keeps them." and named the gap
 * precisely: the ask route searched, answered and returned without writing a
 * row. Migration 221 writes the row — session, question, outcome, citations and
 * the router's own cost receipt — so the sentence stopped being true and the
 * card went with it, along with the `unbuilt:` prose on four filter chips and
 * two ops in four tables.
 *
 * A gap card outliving its gap is worse than never having written one: it is a
 * confident, specific, prominent claim that the product cannot do something it
 * now does. Whoever closes `markets` or `companies` deletes their entry in the
 * same commit.
 */
