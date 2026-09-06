import { count, summary, title, top, usd } from './format.js';

/*
 * `/offers` — Partner Operator Canvas P5, "Package what we sell".
 *
 * VISIBILITY IS THE SECTION WORTH READING THE CANVAS AGAINST. P5 subtitles it
 * "Where the firm appears · conversion per surface". `GET /offers/visibility`
 * returns a per-surface engagement count that is real, and then two explicit
 * refusals: `views: null` ("No impression is recorded anywhere in the product,
 * so a view count would be invented rather than measured") and
 * `lead_ratio: null` ("Engagements per surface is real. Leads per surface is
 * not recorded anywhere, so the ratio between them has an absent denominator
 * and is not stated"). A conversion needs both ends. The board shows the end
 * that exists and prints the worker's sentence for the one that does not.
 *
 * `unattributed_note` matters just as much and is easy to drop: engagements
 * that name no surface are counted against none of them, so the per-surface
 * column does not add up to the total, and the reason is said rather than left
 * for a reader to discover by subtracting.
 *
 * Proof reports TWO counts because one would mislead. The worker's own words:
 * "3 case studies" and "3 case studies, none of which the client agreed to
 * publish" describe very different storefronts.
 */
export default function partnerOffersBoard(role, api) {
  return {
    sources: {
      catalog: () => api.listServiceOfferings({ mine: 1 }),
      perks: () => api.perksMine(),
      visibility: () => api.getPartnerVisibility(),
      proof: () => api.listPartnerProof(),
      fit: () => api.listPartnerFitRules(),
    },
    sections: [
      {
        slug: 'catalog',
        anchor: 'of-catalog',
        title: 'Capability catalog',
        span: 'full',
        source: 'catalog',
        cols: '1.8fr 1.2fr 1fr',
        columns: ['Offering', 'Category', 'Price'],
        empty: 'Nothing is listed in this firm’s catalog yet.',
        summary: (d) => summary(count(Array.isArray(d?.items) ? d.items.length : null, 'offering')),
        rows: (d) => top(d?.items).map((o) => [o.name, title(o.category), usd(o.price)]),
        footnote: () =>
          'The catalog is what a founder browsing the network sees. Each entry carries its own '
          + 'pricing model; nothing here quotes against a posted need on the firm’s behalf.',
      },
      {
        slug: 'perk-deals',
        anchor: 'of-deals',
        title: 'Perk deals',
        span: 'half',
        source: 'perks',
        cols: '1.7fr 1fr',
        columns: ['Perk', 'State'],
        empty: 'This firm has submitted no perk yet.',
        summary: (d) => summary(
          count((d?.items || []).filter((p) => p.status === 'live').length, 'live', 'live'),
        ),
        rows: (d) => top(d?.items).map((p) => [p.title || p.name, title(p.status)]),
        footnote: () =>
          'A perk is submitted here and reviewed before it appears. The canvas also counts '
          + 'expired deals whose grants were revoked; expiry is not a state a perk record carries, '
          + 'so a perk reads by the state it actually has.',
      },
      {
        slug: 'visibility',
        anchor: 'of-visibility',
        title: 'Visibility',
        span: 'half',
        source: 'visibility',
        cols: '1.5fr 1fr 1fr',
        columns: ['Surface', 'Engagements', 'Won'],
        empty: 'No surface is recorded for this firm yet.',
        summary: (d) => summary(count(d?.engagement_total, 'engagement')),
        rows: (d) => top(d?.items).map((s) => [s.name, s.engagement_count, usd(s.won_value)]),
        // Both refusals, in the worker's own words, plus the attribution gap
        // that stops the column adding up to the total.
        footnote: (d) => summary(d?.unattributed_note, d?.lead_ratio_note),
      },
      {
        slug: 'proof',
        anchor: 'of-proof',
        title: 'Case studies & proof',
        span: 'half',
        source: 'proof',
        cols: '1.8fr 1.2fr',
        columns: ['Proof', 'Client'],
        empty: 'No case study or proof item is recorded yet.',
        summary: (d) => summary(
          count(d?.published_count, 'agreed', 'agreed'),
          count(d?.self_stated_count, 'self-stated', 'self-stated'),
        ),
        rows: (d) => top(d?.items).map((p) => [p.title, p.founder_name]),
        footnote: () =>
          'Two counts rather than one, because a case study the client agreed to publish and one '
          + 'the firm states about itself are not the same claim. Consent is recorded against the '
          + 'person who gave it and can be withdrawn.',
      },
      {
        slug: 'audience-fit',
        anchor: 'of-fit',
        title: 'Audience fit',
        span: 'half',
        source: 'fit',
        cols: '1.9fr 1.1fr',
        columns: ['Rule', 'Kind'],
        empty: 'No fit rule is recorded, so nothing states who this firm is for.',
        summary: (d) => summary(
          count((d?.items || []).filter((r) => r.is_active).length, 'in use', 'in use'),
        ),
        rows: (d) => top((d?.items || []).filter((r) => r.is_active)).map((r) => [
          r.statement, title(r.kind),
        ]),
        footnote: (d) => summary(
          d?.enforcement_note,
          d?.unstated_count
            ? 'A rule with no statement produces exactly the silence this zone exists to replace.'
            : null,
        ),
      },
    ],
  };
}
