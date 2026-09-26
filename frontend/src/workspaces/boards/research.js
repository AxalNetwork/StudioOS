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
      // D391 — the zone this card opens is `MarketZone`: comparable ranges the
      // firm enters for its own service lines (migration 223), each with its run
      // date and an age gate. It stopped being the signals feed when that zone
      // was rebuilt, and this blurb still described the feed.
      card('markets', 'Markets', 'Comparable ranges you entered for your own work, each with the date it was run and how old it is.'),
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
        // D391 — "Nobody can send you a document" stopped being true for an
        // advisor at migration 218: a founder can open their data room to a named
        // advisor. Those files are read on Client prep under the founder's grant
        // and never copied here, so the library sentence is about the library.
        footnote: () => (isPartner
          ? 'Only what you uploaded yourself. Ask answers from these documents and nothing else.'
          : 'Only what you uploaded yourself. Files a founder opens to you under a grant are read '
            + 'in Client prep and never copied here, so Ask cannot cite them.'),
      },
    ],
  };
}
