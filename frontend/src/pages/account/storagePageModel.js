/**
 * D1166 (#2449) — the words of `/account/usage/storage`, Usage's fourth page,
 * from the canvas "Account · Usage · Storage" (`Account Storage Page.dc.html`,
 * boards STG1–STG20). Pure, so `frontend/test/storage_page_d1166.test.mjs`
 * holds each rule.
 *
 * WHAT IS READ TODAY. D642's `GET /api/usage/storage`: the member's total,
 * file count and places (thirteen since D1169, which also returns the plan,
 * kinds, companies and largest files that part 5 draws). No plan carries a storage allowance yet, and the
 * read has no kinds, companies or largest files, so those blocks say "Not read
 * here yet" with their reason and never draw a zero, a bar or a figure from
 * the owner's table (D1166 §2).
 */

export const STORAGE_PAGE = Object.freeze({
  title: 'Storage',
  sub: 'How much you keep on StudioOS, across all your companies.',
});

export const NOT_YET = 'Not read here yet';

/** Why a block draws nothing today. Never a zero, never "none". */
export const WAITS = Object.freeze({
  allowance: 'No plan carries a storage allowance yet, so this page shows what you store and not how much of a plan it uses. Uploads are not paused for space.',
  kinds: 'Storage by kind (documents, data rooms, recordings, decks and exports, messages, images) is not read yet. Your files by place are below.',
  companies: 'Storage by company and venture is not read yet. This page counts every company at once; switching company does not change it.',
  largest: 'Your largest files are not read yet. When they are, Open takes you to where each file lives.',
  counts: 'The full list is drawn with the rest of this page. Every place below counts today, including earlier versions, Record a Session audio and deck reviews (D1169).',
});

/** STG1's "What counts", byte for byte from the canvas. */
export const DOES_NOT_COUNT = Object.freeze(['Identity documents', 'Signed legal copies', 'Fund documents', 'Anything Axal VC publishes']);

/** STG17: Cost's details no longer hold storage. */
export const COST_STORAGE_NOTE = 'Storage no longer sits in this list. It has its own page, Usage › Storage.';
