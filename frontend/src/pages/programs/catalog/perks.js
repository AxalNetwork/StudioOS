/**
 * D6972 (#6972) — Perks' map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/perks.js`. `/perks` is the signed-in
 * catalogue, so `/programs/perks` is the canonical page. A new edition of the PDF is a new file
 * (`-v2`) and this line's `pdf` and `edition`; the page's address never changes.
 *
 * "Open to all members" is the registry's join method "Open" (migration 560: status live,
 * HQ-held). The program's running status is stated as of this edition, in the content, never
 * read live; a new status is a new edition.
 */
export default {
  key: 'perks',
  name: 'Perks',
  group: 'Rewards',
  avail: 'open',
  eyebrow: 'Rewards · partner offers, reviewed before they are listed',
  purpose: 'Founders find partner offers in one reviewed catalogue, read each offer’s conditions, and claim it with perk credits, through their plan, or by paying the partner.',
  audience: 'Founders weighing the benefits, members browsing them, and partners who supply the offers.',
  canonical: '/programs/perks',
  pdf: '/program-briefs/axal-vc-perks-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 6,
  og: {
    title: 'Perks · Programs',
    description: 'Founders find partner offers in one reviewed catalogue, read each offer’s conditions, and claim it with perk credits, through their plan, or by paying the partner.',
  },
  card: {
    who: 'Founders, members browsing, and partners who supply offers',
    line: 'Founders claim. Members browse. Partners supply.',
  },
};
