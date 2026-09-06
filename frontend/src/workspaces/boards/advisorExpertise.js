import { count, day, summary, title, top, usdCents } from './format.js';
import { ADVISOR_EXPERTISE_COPY } from '../noStoreCopy.js';

/*
 * `/expertise` — Advisor Canvas V4, "Package what I know".
 *
 * VISIBILITY IS A GAP, AND THE GAP IS THE ZONE'S OWN WORDS. V4 draws a "Where
 * you appear" panel; `COPY['/expertise'].visibility` in `AdvisorBucketRoutes`
 * says why it is empty — "There is no impression or profile-view counter
 * anywhere in the product — not for advisors, not for anyone" — and that object
 * is handed to this section rather than a second, gentler sentence being
 * written here. A board section can never be kinder than the page behind it,
 * because it is reading the same object the page reads.
 *
 * THINKING COUNTS OPENS ON THIS HUB, AND SAYS SO. V4 subtitles it "6 pieces ·
 * 14,200 reads". `articles.views` is real, but it counts opens of the article
 * on this hub and nothing else — not syndication, not a newsletter, not a link
 * someone forwarded. The zone blurb already draws that line ("how many people
 * opened it here"), and the footnote keeps it.
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
        summary: (d) => summary(
          count((d?.items || []).filter((s) => s.is_active).length, 'live', 'live'),
        ),
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
          count((d?.items || []).filter((p) => p.status === 'attested').length, 'confirmed', 'confirmed'),
          count((d?.items || []).filter((p) => p.status !== 'attested').length, 'self-stated', 'self-stated'),
        ),
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
        summary: (d) => summary(
          count((d?.items || []).filter((a) => a.status === 'published').length, 'published', 'published'),
        ),
        rows: (d) => top(d?.items).map((a) => [a.title, a.views, day(a.published_at)]),
        footnote: () =>
          'Opens counts people who opened the piece here. It is not a readership figure — nothing '
          + 'tracks syndication, forwards or anywhere else it may have been read.',
      },
      {
        slug: 'visibility',
        anchor: 'ex-visibility',
        title: 'Visibility',
        span: 'half',
        // The zone page's own object, imported — not a second sentence.
        gap: ADVISOR_EXPERTISE_COPY.visibility,
      },
    ],
  };
}
