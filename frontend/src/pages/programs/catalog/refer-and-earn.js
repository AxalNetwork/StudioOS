/**
 * D6971 (#6971) — Refer & Earn's map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/refer-and-earn.js`. The program has no public
 * page of its own (`/referrals` is the signed-in member page), so `/programs/refer-and-earn` is
 * the canonical page. A new edition of the PDF is a new file (`-v2`) and this line's `pdf` and
 * `edition`; the page's address never changes.
 *
 * "Open to all members" is the canvas's label for the registry's join method "Open"
 * (migration 560: status live). Whether accounts still exploring are "members" here is an owner
 * question on D6971; the label is kept as drawn.
 */
export default {
  key: 'refer-and-earn',
  name: 'Refer & Earn',
  group: 'Network and referrals',
  avail: 'open',
  eyebrow: 'For Axal VC members · nothing to apply for',
  purpose: 'Share your member link: when someone signs up through it and verifies their email, you earn an introduction credit.',
  audience: 'Founders, investors, advisors and partners on Axal VC who want to introduce founders or other people who would use the platform.',
  canonical: '/programs/refer-and-earn',
  pdf: '/program-briefs/axal-vc-refer-and-earn-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Refer & Earn · Programs',
    description: 'Share your member link: when someone signs up through it and verifies their email, you earn an introduction credit.',
  },
  card: {
    who: 'Founders, investors, advisors and partners on Axal VC',
    line: 'Nothing to apply for: your link is on your Refer & Earn page.',
  },
};
