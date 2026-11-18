/**
 * D6029 (#6029, Build v2 BD23 / BU23) — Build's navigation and module copy.
 *
 * `BUILD_OUTCOMES`: each module's subtitle as a founder outcome, in BD23's
 * words. It replaces "Records below; the tabs above move between modules.",
 * which described the page rather than the job.
 *
 * `BUILD_DESTINATIONS`: the Build-level pages, after Overview and before the
 * modules: Plan, Progress, then Tools. Tools keeps its current address (the
 * Tools section of Operating systems) until #5078 makes it one page.
 */
export const BUILD_OUTCOMES = Object.freeze({
  'solution-design': 'Decide what you are building, and tie every feature to the evidence behind it.',
  'prototype-mvp': 'Ship the smallest product that tests what Validate proved.',
  'product-roadmap': 'Decide what ships now, next and later, and show what shipped.',
  'founding-team': 'Agree who builds the company, and on what terms.',
  'company-creation': 'Get the company formed, then keep its filings current.',
  'operating-systems': 'Run the company on connected systems and a weekly rhythm.',
});

/** A Build module's subtitle, or null for a slug BD23 does not name. */
export const buildOutcome = (slug) => BUILD_OUTCOMES[slug] || null;

export const BUILD_DESTINATIONS = Object.freeze([
  Object.freeze({ key: 'plan', name: 'Plan', path: '/build/plan' }),
  Object.freeze({ key: 'progress', name: 'Progress', path: '/build/plan/progress' }),
]);
