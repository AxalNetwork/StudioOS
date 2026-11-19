/**
 * D6966 (#6966) — Spin-Out Lab's map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/spinout-lab.js`. A new edition of the PDF is
 * a new file (`-v2`) and this line's `pdf` and `edition`; the page's address never changes.
 */
export default {
  key: 'spinout-lab',
  name: 'Spin-Out Lab',
  group: 'Ventures',
  avail: 'apply',
  eyebrow: 'A four-week programme, by application',
  purpose: 'Four weeks to test demand, build your pitch and prepare for investor conversations.',
  audience: 'Founders testing an idea or a new product. Studio operators can see how a cohort is run.',
  // The existing public brief is the presentation; /programs/spinout-lab resolves to it.
  canonical: '/spinout-lab/brief',
  pdf: '/program-briefs/axal-vc-spinout-lab-v1.pdf',
  // Owner, 2026-11-19 (#6966): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Spin-Out Lab · Programs',
    description: 'Four weeks to test demand, build your pitch and prepare for investor conversations. By application, with a five-slide PDF to download.',
  },
  card: { who: 'Founders testing an idea or a new product' },
};
