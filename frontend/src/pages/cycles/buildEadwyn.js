/**
 * D5077 (#5077) — what Eadwyn offers on each Build module page, to the Build
 * V2 canvas's BD21 B ("Suggested asks per module", `design/incoming/Build v2
 * Page.dc.html`'s `SUGG` and `eadSugg`).
 *
 * Each ask is a question the founder can send to Ask Eadwyn. Pressing one
 * fills the composer with its words and sends nothing: it never runs on its
 * own (BD21 A), and it never picks a model. The same list feeds the rail's
 * prompts (`WorkerRail`'s `prompts`), the zero-state Ask block on the desktop
 * page (BD18 A) and the folded Ask entry on the phone (BD24 A), so the three
 * never disagree.
 *
 * Where the board names a sample record ("CSV import", "Data import", the
 * setup wizard, 83(b)), the ask names the kind of record instead: the page
 * cannot know a venture's own feature or filing names before it reads them.
 *
 * Monday plans, retros, roadmap ordering and metric annotations are offered
 * only where that work lives (Product roadmap, Operating systems), never as
 * the whole of Build's description on every module (the 8 November audit).
 */

export const BUILD_ASKS = Object.freeze({
  'solution-design': Object.freeze([
    'Which features have no evidence link?',
    'Challenge the MVP scope',
    'Draft a description for a feature',
  ]),
  'prototype-mvp': Object.freeze([
    'What is blocking the must-haves?',
    'Which must-have should be next?',
    'Draft a Lovable prompt for a must-have',
  ]),
  'product-roadmap': Object.freeze([
    'What should move into Now?',
    'Which items have no KPI?',
  ]),
  'founding-team': Object.freeze([
    'Which founders lack vesting terms?',
    'Summarise the equity split',
  ]),
  'company-creation': Object.freeze([
    'What is still outstanding to form the company?',
    'Explain the nearest filing deadline',
    'Prepare the checklist wording for the next filing',
  ]),
  // BD20's Systems and Cadence are one page until #5078 splits them: both tabs' asks, Systems first.
  'operating-systems': Object.freeze([
    'Which systems still need connecting?',
    'What breaks if a system stays disconnected?',
    'What slipped since the last retro?',
    'Summarise last week for the review',
  ]),
});

/**
 * The rail's one sentence under its switch on each Build module (`WorkerRail`'s
 * `note`). A module whose Eadwyn work is only its asks has none (`null`), so
 * the desk-wide sentence about Monday plans and retros is not printed there.
 */
export const BUILD_RAIL_NOTES = Object.freeze({
  'solution-design': null,
  'prototype-mvp': null,
  'product-roadmap': 'Argues one roadmap ordering from the horizons and quarters you have set.',
  'founding-team': null,
  'company-creation': null,
  'operating-systems': 'Drafts a Monday plan from what moved, summarises the week on the board for a Friday retro, and annotates the metric that moved most.',
});

const own = (map, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);

/** A Build module's asks, or null for any other page (the overview, another cycle, an unknown slug). */
export function moduleAsks(cycle, slug) {
  return cycle === 'build' && own(BUILD_ASKS, slug) ? BUILD_ASKS[slug] : null;
}

/**
 * The rail's note on a Build module: its own sentence or `null` for none.
 * `undefined` off a Build module, so the caller keeps the desk's sentence there.
 */
export function moduleRailNote(cycle, slug) {
  return cycle === 'build' && own(BUILD_RAIL_NOTES, slug) ? BUILD_RAIL_NOTES[slug] : undefined;
}

/** BD24 A's folded entry: "3 suggestions for this module". */
export function asksCountLabel(asks) {
  const n = Array.isArray(asks) ? asks.length : 0;
  return `${n} suggestion${n === 1 ? '' : 's'} for this module`;
}
