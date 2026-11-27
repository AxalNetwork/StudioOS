/**
 * D1385 (#3731, #2409 part 1) — "Your PostHog projects": pure, so
 * `frontend/test/posthog_projects_d1385.test.mjs` holds each rule and word.
 * The reads are `GET /api/connectors/:uid/posthog-projects` (routes/posthog.ts).
 */

export const CHOOSE_LINE = 'Each company uses one PostHog project. Axal VC reads it and never changes it.';
export const UNLINK_LINE = 'Axal VC stops reading this PostHog project for the venture. Nothing in PostHog changes.';

const REGION_WORDS = Object.freeze({ US: 'US Cloud', EU: 'EU Cloud' });
export const regionWords = (r) => REGION_WORDS[r] || 'Region not recorded';

/** One venture's row: its project, or the teammate whose PostHog serves it, or a choice to make. */
export function rowOf(v) {
  if (v?.link) {
    return { state: 'linked', line: `${v.link.name || 'Project not named'} · ${regionWords(v.link.region)}`, action: 'change' };
  }
  if (v?.served_by) {
    return { state: 'served', line: `Served by ${v.served_by.name || 'a teammate'}’s PostHog`, action: null };
  }
  return { state: 'unlinked', line: 'Choose a project', action: 'choose' };
}

/** The read, made safe to draw: never a zero for a list that did not load. */
export function projectsRead(out) {
  const ventures = Array.isArray(out?.ventures) ? out.ventures : [];
  const choices = Array.isArray(out?.choices) ? out.choices : null;
  return {
    ventures,
    choices,
    choicesError: out?.choices_error?.detail || (choices ? null : 'Your PostHog projects could not be read. Try again.'),
  };
}

/** What an empty venture list means. */
export const NO_VENTURES = 'No venture to link yet. Switch PostHog on for a company above, then choose its project here.';

/** A refused write in this page's words: the Worker's sentence, never PostHog's. */
export function refusalOf(e) {
  return String(e?.data?.detail || e?.message || 'That did not work. Try again.');
}
