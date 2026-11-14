// Brand & Landing — audience-first flow helpers (Task #30).
//
// Pure helpers that drive the reworked wizard:
//
//   Step 1 — Pick project & audience  → suggestAudienceAndGoal()
//   Step 2 — Pick a template          → getRecommendedTemplatesForAudience()
//   Step 3 — Tune brand kit & copy    → generateInitialBrandKit()
//   Step 4 — Share                    → (handled by the main app, no helper)
//
// No I/O, no network. generateInitialBrandKit() returns deterministic
// placeholder copy the wizard can edit or later replace with an AI layer.

import { AUDIENCES, GOALS, getTemplatesByAudience } from './templates.js';

/**
 * Minimal project shape this library needs. The main app's Project has more.
 * @typedef {Object} ProjectSummary
 * @property {string|number} [id]
 * @property {string} [name]
 * @property {string} [sector]
 * @property {string} [oneLiner]   one-paragraph / one-line description
 * @property {string} [description] fallback for oneLiner
 * @property {string} [problem]    optional, used to seed subheadline
 * @property {string} [solution]   optional, used to seed subheadline
 */

/**
 * Seeded brand-kit copy returned for Step 3.
 * @typedef {Object} InitialBrandKit
 * @property {string} brandName
 * @property {string} headline
 * @property {string} subheadline
 * @property {string} ctaLabel
 */

/**
 * Sensible default goal for each audience.
 * @type {Record<import('./templates.js').Audience, import('./templates.js').Goal>}
 */
const DEFAULT_GOAL_BY_AUDIENCE = {
  customer: 'join_waitlist',
  investor: 'request_intro',
  partner: 'start_pilot',
  advisor: 'offer_guidance',
  mentor: 'offer_guidance',
  cofounder: 'apply',
};

/**
 * Step 1 — propose an audience + goal for a project.
 * Uses the preferred audience when valid, otherwise defaults to 'customer'.
 * @param {ProjectSummary} _project
 * @param {import('./templates.js').Audience} [preferredAudience]
 * @returns {{ audience: import('./templates.js').Audience, goal: import('./templates.js').Goal }}
 */
export function suggestAudienceAndGoal(_project, preferredAudience) {
  const audience = AUDIENCES.includes(preferredAudience) ? preferredAudience : 'customer';
  const goal = DEFAULT_GOAL_BY_AUDIENCE[audience];
  return { audience, goal };
}

/**
 * Step 2 — templates recommended for an audience, recommended-first.
 * @param {import('./templates.js').Audience} audience
 * @returns {import('./templates.js').TemplateConfig[]}
 */
export function getRecommendedTemplatesForAudience(audience) {
  return getTemplatesByAudience(audience);
}

const clean = (s) => (typeof s === 'string' ? s.trim() : '');

/**
 * Goal-specific copy seeds. Each returns { headline, subheadline } given the
 * brand name and a one-liner. Deterministic placeholders only.
 * @type {Record<import('./templates.js').Goal, (name: string, oneLiner: string) => { headline: string, subheadline: string }>}
 */
const COPY_BY_GOAL = {
  join_waitlist: (name, oneLiner) => ({
    headline: oneLiner || `${name} is launching soon.`,
    subheadline: `Join the waitlist and be first to try ${name}.`,
  }),
  request_intro: (name, oneLiner) => ({
    headline: oneLiner || `${name} — building the future of our category.`,
    subheadline: `We're raising. Request a warm intro to learn about the round.`,
  }),
  start_pilot: (name, oneLiner) => ({
    headline: oneLiner || `Run a pilot with ${name}.`,
    subheadline: `Partner with ${name} on a focused pilot and prove the value together.`,
  }),
  book_call: (name, oneLiner) => ({
    headline: oneLiner || `Let's explore working together.`,
    subheadline: `Book a call to see how ${name} fits your roadmap.`,
  }),
  apply: (name, oneLiner) => ({
    headline: `Build ${name} with us.`,
    subheadline: oneLiner || `We're looking for a founding teammate to shape what comes next.`,
  }),
  offer_guidance: (name, oneLiner) => ({
    headline: `Help shape ${name}.`,
    subheadline: oneLiner
      ? `${oneLiner} — share your expertise and guide the team.`
      : `Share your expertise and guide the team as we grow.`,
  }),
};

/**
 * Step 3 — seed editable brand-kit copy from a project + chosen template.
 * @param {ProjectSummary} project
 * @param {import('./templates.js').TemplateConfig} template
 * @param {import('./templates.js').Goal} goal
 * @returns {InitialBrandKit}
 */
export function generateInitialBrandKit(project, template, goal) {
  const proj = project || {};
  const brandName = clean(proj.name) || clean(template && template.label) || 'Your venture';
  const oneLiner = clean(proj.oneLiner) || clean(proj.description);

  const effectiveGoal = GOALS.includes(goal)
    ? goal
    : (template && template.primaryGoal) || 'join_waitlist';
  const builder = COPY_BY_GOAL[effectiveGoal] || COPY_BY_GOAL.join_waitlist;
  const { headline, subheadline } = builder(brandName, oneLiner);

  const ctaLabel = clean(template && template.defaultCtaLabel) || 'Get started';

  return { brandName, headline, subheadline, ctaLabel };
}
