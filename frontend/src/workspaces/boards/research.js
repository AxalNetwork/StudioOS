import { count, day, summary, top } from './format.js';

/*
 * `/research` — Partner Operator Canvas P7 and Advisor Canvas V6.
 *
 * BOTH ARTBOARDS DRAW EXACTLY TWO SECTIONS — `rs-client` (client prep) and
 * `rs-library` — over buckets of four and five zones. Ask, Markets and
 * Companies have live stores and no artboard section, so they render as link
 * cards in zone order rather than as sections the design never drew. Composing
 * one would be the same offence as inventing a number: it would put a layout on
 * screen that nobody designed and that nothing in the corpus can be checked
 * against.
 *
 * CLIENT PREP IS A GAP ON BOTH LICENCES, and the reason is the one its own zone
 * page renders. Half a client brief exists — the topic and the questions the
 * client wrote when they asked for the session — and the other half is the
 * client's project record, which is closed by rule rather than absent. Task #55
 * is the grant that opens it; until then the section says so.
 *
 * The library section is the one live store here: each user's own uploads, and
 * which of them Ask can actually cite.
 */
export default function researchBoard(role, api) {
  const isPartner = role === 'partner';
  const card = (slug, title, blurb) => ({ slug, kind: 'card', title, blurb });
  return {
    sources: {
      library: () => api.research.documents(),
    },
    sections: [
      card('ask', 'Ask', 'Questions answered only from your own library, with the passage each answer used.'),
      // A CARD, NOT A GAP, BECAUSE THE ZONE IS LIVE. This rendered the shared
      // client-prep no-store copy — eyebrow "No store behind this yet", heading
      // "The client brief is not built yet" — on both `/research` roots, over a
      // zone that is in `LIVE_ZONES`, renders a real body, and reads five API
      // methods across migrations 218 and 222. A card telling a reader a working
      // feature does not exist is worse than a missing button.
      //
      // NOTHING WAS LOST WITH THAT COPY. Its one good sentence — that what
      // stands in the way is an access decision rather than an absent table — is
      // already in the zone's own empty state, said PER ROLE and so more
      // accurately than one board sentence could: a partner reads that nothing
      // here requests a record, an advisor reads where the half they already hold
      // lives. `advisor_bucket_overview.test.mjs` now asserts it there.
      card('client-prep', 'Client prep',
        'One client per brief, assembled from what they opened to you and what you already hold.'),
      card('markets', 'Markets', 'Signals from the sectors you work in, with the date each one was gathered.'),
      ...(isPartner ? [] : [
        card('companies', 'Companies', 'The competitor and market analyses you have run yourself.'),
      ]),
      {
        slug: 'library',
        anchor: 'rs-library',
        title: 'Document library',
        span: 'full',
        source: 'library',
        cols: '1.9fr 1fr 1fr 1fr',
        columns: ['Document', 'Kind', 'State', 'Added'],
        empty: 'Nothing is in your library yet, so Ask has nothing to read.',
        summary: (d) => summary(
          count(d?.indexed, 'answerable', 'answerable'),
          count(d?.not_indexed, 'not answerable', 'not answerable'),
        ),
        rows: (d) => top(d?.items).map((x) => [
          x.title, x.kind, x.index_state, day(x.created_at),
        ]),
        footnote: () =>
          'Your own uploads. Nobody can send you a document — a founder sharing their own file '
          + 'needs a grant type this product has for investors and for no one else.',
      },
    ],
  };
}
