/**
 * D6974 (#6974) — Product testing's map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/product-testing.js`. A new edition of the PDF
 * is a new file (`-v2`) and this line's `pdf` and `edition`; the page's address never changes.
 */
export default {
  key: 'product-testing',
  name: 'Product testing',
  group: 'Product',
  // programsModel.js: join "By application" (the tester pool, then each campaign).
  avail: 'apply',
  eyebrow: 'Run by Axal VC HQ · campaigns from HQ and partners',
  purpose: 'Members approved as testers try products in campaigns that Axal VC HQ runs, or approves for a partner firm, and each campaign’s owner picks its testers.',
  audience: 'Members who want to test products, and partner firms proposing a testing campaign.',
  // No page of its own (members use it from Studio, partners at /offers/testing): /programs/product-testing is the presentation.
  canonical: '/programs/product-testing',
  pdf: '/program-briefs/axal-vc-product-testing-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Product testing · Programs',
    description: 'Members approved as testers try products in campaigns that Axal VC HQ runs, or approves for a partner firm, and each campaign’s owner picks its testers.',
  },
  card: {
    who: 'Members who test products, and partner firms',
    line: 'Open campaigns are listed in Studio for active testers.',
  },
};
