/**
 * D6968 (#6968) — Mentor cohort access's map entry: registry key → canonical page → committed PDF.
 *
 * The registry row (`programsModel.js` PROGRAMS, `560_program_registry.sql`): group Access,
 * Live, join "Assigned by an admin". No public read exists for this program, so the page's
 * availability panel is a fixed statement and nothing here names a cohort, a count or a date.
 * Plain data with no imports. The page and the slides are `../content/mentor-cohorts.js`.
 */
export default {
  key: 'mentor-cohorts',
  name: 'Mentor cohort access',
  group: 'Access',
  avail: 'assigned',
  eyebrow: 'One Spin-Out Lab cohort per assignment',
  purpose: 'An admin assigns an advisor to one Spin-Out Lab cohort, so the advisor can follow that cohort’s founders week by week and guide them.',
  audience: 'Advisors who may mentor a Lab cohort, and the staff who assign them.',
  canonical: '/programs/mentor-cohorts',
  pdf: '/program-briefs/axal-vc-mentor-cohorts-v1.pdf',
  // Owner, 2026-11-19 (#6965): edition 1 is dated November 2026; the wording is approved in review.
  edition: 'Edition 1 · November 2026',
  slides: 5,
  og: {
    title: 'Mentor cohort access · Programs',
    description: 'An admin assigns an advisor to one Spin-Out Lab cohort, so the advisor can follow that cohort’s founders week by week and guide them. A five-slide PDF to download.',
  },
  // The index card (pilot canvas PGS08), in the registry's words rather than the example's "By invitation only".
  card: { who: 'Advisors an admin assigns to a cohort', line: 'No one applies: an admin assigns each mentor.' },
};
