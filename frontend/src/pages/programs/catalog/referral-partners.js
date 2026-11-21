/**
 * D6970 (#6970) — Referral partners' map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/referral-partners.js`. The program has no page
 * of its own, so `/programs/referral-partners` is the canonical page. A new edition of the PDF is
 * a new file (`-v2`) and this line's `pdf` and `edition`; the page's address never changes.
 *
 * "By invitation only" is the registry's join method (migration 593: "By invitation. HQ adds the
 * partner; their own referral code earns."), not a live read.
 */
export default {
  key: 'referral-partners',
  name: 'Referral partners',
  group: 'Network and referrals',
  avail: 'invite',
  eyebrow: 'Run by Axal VC HQ',
  purpose: 'People who bring Axal VC events, startups, deals and LPs, invited by HQ and earning only under agreed terms.',
  audience: 'Event organisers, venture scouts and deal makers considering an invited partner relationship.',
  canonical: '/programs/referral-partners',
  pdf: '/program-briefs/axal-vc-referral-partners-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Referral partners · Programs',
    description: 'People who bring Axal VC events, startups, deals and LPs, invited by HQ and earning only under agreed terms.',
  },
  card: {
    who: 'Event organisers, venture scouts and deal makers HQ invites',
    line: 'No one applies: HQ invites each partner.',
  },
};
