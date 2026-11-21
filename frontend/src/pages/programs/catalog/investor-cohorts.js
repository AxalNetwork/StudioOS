/**
 * D6969 (#6969) — Investor cohort access's map entry: registry key → canonical page → committed PDF.
 *
 * The registry row (`programsModel.js` PROGRAMS): group Access, "Partly built", join "Assigned
 * by an admin", operation "Not running" (`NOT_RUNNING_YET`). The page explains the workflow and
 * keeps it apart from whether HQ has opened it: HQ has
 * published no dated decision, so this edition says "Not running yet". A decision is a new
 * edition (`-v2`). Plain data with no imports. The page and the slides are
 * `../content/investor-cohorts.js`.
 */
export default {
  key: 'investor-cohorts',
  name: 'Investor cohort access',
  group: 'Access',
  avail: 'assigned',
  eyebrow: 'Run by Axal VC HQ · one Lab cohort per grant',
  purpose: 'Verified investors read one Spin-Out Lab cohort’s ventures, within the scope and dates an Administrator records, once they have signed the cohort NDA.',
  audience: 'Verified investors learning how cohort access works, and Axal VC HQ staff presenting it.',
  canonical: '/programs/investor-cohorts',
  pdf: '/program-briefs/axal-vc-investor-cohorts-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Investor cohort access · Programs',
    description: 'How verified investors are given access to one Spin-Out Lab cohort, within a recorded scope and dates, after signing the cohort NDA. Not running yet. A five-slide PDF to download.',
  },
  card: { who: 'Verified investors an admin assigns to a cohort', line: 'Not running yet. HQ has published no decision to open it.' },
};
