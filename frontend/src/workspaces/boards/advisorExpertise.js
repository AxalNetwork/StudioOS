import { count, day, summary, title, top, usdCents } from './format.js';

/** A list's full-set total from its page facts (#4689), or null when the answer carries none. */
const pageTotal = (page) => (Number.isInteger(page?.total) ? page.total : null);

/*
 * `/expertise` — Advisor Canvas V4, "Package what I know".
 *
 * VISIBILITY READS WHAT IS RECORDED (D1597, mounted by D1424). V4 draws a
 * "Where you appear" panel. It was a gap card; it is now requests per booking
 * link in the last 30 days, the same read the zone page makes, with the
 * Worker's own sentence that no profile view is recorded as its footnote. A
 * board section can never be kinder than the page behind it.
 *
 * THINKING COUNTS OPENS ON THIS HUB, AND SAYS SO. V4 subtitles it "6 pieces ·
 * 14,200 reads". `articles.views` is real, but it counts each open of the
 * article on this hub (one person opening twice is two) and nothing else — not syndication, not a newsletter, not a link
 * someone forwarded. The zone blurb already draws that line ("how many people
 * opened it here"), and the footnote keeps it.
 *
 * EVERY FIGURE IS THE WHOLE LIST (#4689). The four list reads return a page
 * (`page`, or `links` for Visibility) and `counts` over the whole list, so a
 * summary reads `counts` or `requests`, a section's `total` reads the page
 * facts' `total`, and nothing is counted off the rows that came back. An
 * answer with no `counts` (an older Worker) shows no figure rather than a
 * page's.
 *
 * PROOF RENDERS TWO KINDS OF EVIDENCE DIFFERENTLY, which is the whole point of
 * the zone: `proofDto` returns `status: 'attested' | 'self_stated'`, because an
 * advisor's own word and a named person's confirmation are not the same claim
 * and must never render identically.
 */
export default function advisorExpertiseBoard(role, api) {
  return {
    sources: {
      profile: () => api.getMyAdvisor(),
      services: () => api.listMyAdvisorServices(),
      proof: () => api.listMyAdvisorProof(),
      thinking: () => api.listMyAdvisorThinking(),
      // D1597 answers 200 with `surfaces: null` when that store failed. That is
      // a failed read, so it rejects here and the board draws its own
      // unreadable state, never this section's "no booking link" empty line.
      visibility: () => api.getMyAdvisorVisibility(30).then((d) => {
        if (!Array.isArray(d?.surfaces)) throw new Error('Your booking links could not be read');
        return d;
      }),
    },
    sections: [
      {
        slug: 'profile',
        anchor: 'ex-profile',
        title: 'Public profile',
        span: 'full',
        source: 'profile',
        cols: '1.2fr 2.4fr',
        columns: ['Field', 'What a founder sees'],
        empty: 'No advisor profile is recorded for this account.',
        summary: (d) => summary(
          d?.is_active ? 'Listed' : 'Not listed',
          count(Array.isArray(d?.expertise) ? d.expertise.length : null, 'expertise tag'),
        ),
        rows: (d) => (d?.uid ? [
          ['Name', d.display_name],
          ['Bio', d.bio],
          ['Expertise', Array.isArray(d.expertise) && d.expertise.length ? d.expertise.join(', ') : null],
          ['Sectors', Array.isArray(d.sectors) && d.sectors.length ? d.sectors.join(', ') : null],
        ] : []),
        footnote: () =>
          'This is what a founder reads before deciding whether to book you. A field you have not '
          + 'filled shows as absent to them too, rather than being quietly omitted.',
      },
      {
        slug: 'services',
        anchor: 'ex-services',
        title: 'Services & pricing',
        span: 'half',
        source: 'services',
        cols: '1.6fr 1fr 1fr',
        columns: ['Service', 'Price', 'State'],
        empty: 'You have listed no service yet.',
        summary: (d) => summary(count(d?.counts?.live ?? null, 'live', 'live')),
        total: (d) => pageTotal(d?.page),
        rows: (d) => top(d?.items).map((s) => [
          s.title, usdCents(s.price_cents), s.is_active ? 'Live' : 'Draft',
        ]),
        footnote: () =>
          'A service with no price reads as unrecorded rather than free — not setting a price is '
          + 'not the same as saying it costs nothing. Nothing counts how often a service is booked.',
      },
      {
        slug: 'proof',
        anchor: 'ex-proof',
        title: 'Proof',
        span: 'half',
        source: 'proof',
        cols: '1.7fr 1.1fr',
        columns: ['Claim', 'Evidence'],
        empty: 'No claim is recorded yet.',
        summary: (d) => summary(
          count(d?.counts?.attested ?? null, 'confirmed', 'confirmed'),
          count(d?.counts?.self_stated ?? null, 'self-stated', 'self-stated'),
        ),
        total: (d) => pageTotal(d?.page),
        rows: (d) => top(d?.items).map((p) => [p.title, title(p.status)]),
        footnote: () =>
          'A claim you made and a claim the named person confirmed are different evidence, so they '
          + 'never render identically. Consent belongs to whoever gave it and can be withdrawn.',
      },
      {
        slug: 'thinking',
        anchor: 'ex-thinking',
        title: 'Published thinking',
        span: 'half',
        source: 'thinking',
        cols: '1.8fr .9fr 1fr',
        columns: ['Piece', 'Opens', 'Published'],
        empty: 'You have published nothing yet.',
        summary: (d) => summary(count(d?.counts?.published ?? null, 'published', 'published')),
        total: (d) => pageTotal(d?.page),
        rows: (d) => top(d?.items).map((a) => [a.title, a.views, day(a.published_at)]),
        footnote: () =>
          'Opens counts each time the piece was opened here, so one person opening it twice counts '
          + 'twice. It is not a count of people or a readership figure — nothing tracks syndication, '
          + 'forwards or anywhere else it may have been read.',
      },
      {
        slug: 'visibility',
        anchor: 'ex-visibility',
        title: 'Visibility',
        span: 'half',
        source: 'visibility',
        cols: '1.8fr 1fr',
        columns: ['Booking link', 'Requests'],
        empty: 'You have no booking link yet.',
        // A failed surfaces read rejects in `sources` above, so `surfaces` is a list here.
        // `requests` is every link's and none's, not the links on the first page.
        summary: (d) => summary(count(d?.requests?.total ?? null, 'request')),
        total: (d) => pageTotal(d?.links),
        rows: (d) => top(d.surfaces).map((s) => [s.name, s.requests]),
        footnote: (d) => summary('Requests in the last month, per link.', d?.views_note),
      },
    ],
  };
}
