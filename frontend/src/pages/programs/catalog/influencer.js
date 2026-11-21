/**
 * D6975 (#6975) — Influencers' map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page is the existing public `/influencers` (`pages/influencer/InfluencersPage.jsx`), drawn
 * with the kit; `/programs/influencer` resolves to it. Its words are `../content/influencer.js`.
 */
export default {
  key: 'influencer',
  name: 'Influencers',
  group: 'Network and referrals',
  avail: 'apply',
  eyebrow: 'Run by Axal HQ · software subscriptions only',
  // #6993 (X11)'s corrected sentence, the same as HERO_LINE in pages/influencer/influencerPublicModel.js
  // (a test keeps the two equal; this file has no imports).
  purpose: 'Share your own handle. When someone subscribes through it, you earn a share of their subscription for a set period.',
  audience: 'Creators and audience owners, such as newsletter writers, podcasters and community leads, who want to introduce people to Axal VC’s software.',
  canonical: '/influencers',
  pdf: '/program-briefs/axal-vc-influencer-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Influencers',
    // The registry's own preview (ogRegistry.js, #6988), word for word, so the map changes nothing there.
    description: 'Share your own handle. When someone subscribes through it, you earn a share of their subscription for a set period.',
  },
  card: {
    who: 'Creators and audience owners',
    line: 'The current rates are read live on the page.',
  },
};
