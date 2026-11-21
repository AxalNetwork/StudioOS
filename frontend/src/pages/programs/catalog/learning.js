/**
 * D6973 (#6973) — Learning's map entry: registry key → canonical page → committed PDF.
 *
 * Plain data with no imports, so the PDF builder and the Open Graph scripts read it in Node.
 * The page and the slides' content is `../content/learning.js`. A new edition of the PDF is a
 * new file (`-v2`) and this line's `pdf` and `edition`; the page's address never changes.
 */
export default {
  key: 'learning',
  name: 'Learning',
  group: 'Learning',
  // The canvas's word (PGL02A) is the registry's join method, "Open or by invitation", per
  // program. The kit's closest key is `open`; the words are the canvas's (README, step 1).
  avail: 'open',
  availText: 'Open or by invitation · per program',
  eyebrow: 'Run by Axal VC HQ',
  purpose: 'Learning programs of courses, videos, exercises and exams that Axal VC HQ publishes for a region or a group.',
  audience: 'Axal VC members who want to learn, the people organising a cohort of learners, and studio Administrators.',
  // No page of its own: /programs/learning is the presentation.
  canonical: '/programs/learning',
  pdf: '/program-briefs/axal-vc-learning-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Learning · Programs',
    description: 'Learning programs of courses, videos, exercises and exams that Axal VC HQ publishes for a region or a group.',
  },
  card: {
    who: 'Members, cohort organisers and studio Administrators',
    line: 'What is open to you shows in Learning after sign-in.',
  },
};
