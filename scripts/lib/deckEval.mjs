/**
 * D1518 (#3770, deck v2 A7) — one harness for the deck: the golden briefs,
 * rubric v0, the investor rubric (recorded, never gated), editing tasks v0,
 * the zero-edit acceptance arm and the benchmark arms. Pure data and pure
 * functions: no model, no network, no TypeScript import, so a test and
 * `scripts/eval-elements.mjs` read the same thing.
 *
 * BRIEFS COME FROM RECORDS, NEVER A PROMPT. New deck has no prompt field
 * (owner direction, plan §0 row 3). A brief is one of the three sample
 * ventures (`cloudflare-worker/test/fixtures/pitchStoryFixtures.ts`: full,
 * sparse, conflicting), the card it is for and the records that card reads:
 * the same input the one-click run reads. A test refuses a brief that carries
 * a prompt or an instruction.
 *
 * SYNTHETIC ONLY: the ventures are made up; no real venture, person or figure.
 */

/** The three sample ventures (D1517's): each a function in pitchStoryFixtures.ts. */
export const VENTURES = Object.freeze({
  full: 'fullRecords',
  sparse: 'sparseRecords',
  conflicting: 'conflictingRecords',
});

/**
 * Rubric v0 is D1517's code rubric (`services/decks/rubric.ts`, `deckRubric`,
 * gate `RUBRIC_GATE`): fit, titles, headings, charts, variety and gaps, out of
 * 100. It is named here, not copied, so there is one rubric.
 */
export const RUBRIC_V0 = Object.freeze({ module: 'cloudflare-worker/src/services/decks/rubric.ts', score: 'deckRubric', gate: 'RUBRIC_GATE' });

/**
 * The investor rubric, v0: what an investor reading the deck would judge, each
 * 1 to 5 by a person. RECORDED, NOT GATED: no build waits on it, and it is
 * never averaged into rubric v0.
 */
export const INVESTOR_RUBRIC_V0 = Object.freeze({
  gated: false,
  scale: [1, 5],
  criteria: Object.freeze([
    { id: 'problem', question: 'Is the problem specific, and backed by what customers said?' },
    { id: 'why_now', question: 'Is it clear why this can be built now and not before?' },
    { id: 'traction', question: 'Do the figures read as recorded rather than claimed?' },
    { id: 'team', question: 'Does the team look able to build and sell this?' },
    { id: 'ask', question: 'Are the round, its terms and the use of funds plain?' },
    { id: 'flow', question: 'Does one card lead to the next without going back?' },
  ]),
});

/**
 * Editing tasks v0 (plan §7.4 editing, §7.4b after generation): what a founder
 * does to a generated deck, each timed by a person against the five bars.
 * Editing stays available after one-click generation, so these are kept beside
 * the zero-edit arm, not replaced by it. `measured` is null until a person
 * times it; nothing here is invented.
 */
export const EDITING_TASKS_V0 = Object.freeze([
  { id: 'swap_layout', section: '7.4', task: 'Give one card another layout and keep every block', target_steps: 2 },
  { id: 'replace_figure_source', section: '7.4', task: 'Point a figure at another record and see its grade change', target_steps: 3 },
  { id: 'reorder_cards', section: '7.4', task: 'Move a card two places and keep the story order', target_steps: 1 },
  { id: 'rewrite_heading', section: '7.4', task: 'Rewrite a heading so it still fits its area', target_steps: 2 },
  { id: 'add_chart', section: '7.4', task: 'Add a chart from a recorded series', target_steps: 3 },
  { id: 'change_theme', section: '7.4', task: 'Change the theme of every card at once', target_steps: 2 },
  { id: 'fix_uncited', section: '7.4b', task: 'Find an Uncited number and link it to a record', target_steps: 3 },
  { id: 'regenerate_card', section: '7.4b', task: 'Regenerate one card\'s words without touching its figures', target_steps: 2 },
  { id: 'trim_overflow', section: '7.4b', task: 'Shorten a card the founder lengthened until it fits again', target_steps: 2 },
  { id: 'export_pdf', section: '7.4b', task: 'Export the edited deck as a PDF with nothing lost', target_steps: 2 },
].map((t) => Object.freeze({ ...t, measured: null })));

/**
 * The benchmark arms: our deck and the five bars. A competitor arm runs only
 * when the owner's decision F (benchmark access) allows it; until then each
 * reads "not run" and no figure is written for it.
 */
export const OWNER_F_PENDING = 'not run: owner decision F (benchmark access) is pending';
export const COMPETITOR_ARMS = Object.freeze(['Gamma', 'Canva', 'Pitch', 'Genspark', 'Dokie']);
/** The zero-edit arm compares against these two on the same brief (dk-auto item 11), once F allows them. */
export const ZERO_EDIT_COMPARED = Object.freeze(['Gamma', 'Dokie']);

/**
 * The zero-edit acceptance arm's verdict (dk-auto item 11, the gate for
 * #3768): the one-click output for a sample venture, exactly as generated,
 * passes when rubric v0 is at least its gate, it draws 0 "Not recorded"
 * placeholders and 0 blocks overflow.
 */
export function zeroEditVerdict({ score, placeholders, overflow }, gate) {
  const reasons = [];
  if (!(Number.isFinite(score) && score >= gate)) reasons.push(`rubric ${score} is under ${gate}`);
  if (placeholders !== 0) reasons.push(`${placeholders} "Not recorded" placeholder(s)`);
  if (overflow !== 0) reasons.push(`${overflow} block(s) overflow`);
  return { pass: reasons.length === 0, reasons };
}

/**
 * The golden briefs, one element each: the venture, the card it is for and
 * the records that card reads. `expect` is what a run must hold to:
 *   records_only  every figure it writes is one its records hold (D1503's
 *                 output rule; a model never invents a number)
 *   fits          the words fit the card's areas at the smallest step
 *   honest_gaps   for the sparse venture: a missing record stays "Not
 *                 recorded", never a made-up figure
 */
const B = (id, element, job, venture, card, records, expect = ['records_only', 'fits']) => Object.freeze({ id, element, job, venture, card, records: Object.freeze(records), expect: Object.freeze(expect) });
export const GOLDEN_BRIEFS = Object.freeze([
  B('title-full', 'title', 'DK2', 'full', 'title', ['grow.arr', 'grow.paying_customers']),
  B('title-sparse', 'title', 'DK2', 'sparse', 'title', ['grow.paying_customers'], ['records_only', 'fits', 'honest_gaps']),
  B('body-problem', 'body', 'DK2', 'full', 'problem', ['validate.top_pain', 'validate.interviews']),
  B('bullets-validation', 'bullets', 'DK2', 'full', 'validation', ['validate.interviews', 'validate.lois', 'validate.claims_validated']),
  B('callout-traction', 'callout', 'DK2', 'conflicting', 'traction', ['grow.mrr', 'grow.mercury_growth']),
  B('kicker-why-now', 'kicker', 'DK2', 'full', 'why_now', ['validate.demand']),
  B('notes-round', 'speaker_notes', 'DK2', 'full', 'round', ['raise.round_target', 'raise.round_terms', 'raise.round_close']),
  B('team-bios', 'team_bios', 'DK2', 'full', 'team', ['team.founders', 'team.archetypes', 'team.skills']),
  B('team-bios-sparse', 'team_bios', 'DK2', 'sparse', 'team', ['team.founders'], ['records_only', 'fits', 'honest_gaps']),
  B('chart-traction', 'chart', 'DK2', 'conflicting', 'traction', ['grow.mrr']),
  B('table-unit-economics', 'table', 'DK2', 'full', 'unit_economics', ['grow.runway', 'grow.net_burn', 'grow.churn']),
  B('timeline-product', 'timeline', 'DK2', 'full', 'product', ['build.releases_90d', 'build.roadmap']),
  B('market-size', 'market_size', 'DK2', 'full', 'market', ['validate.competitors', 'validate.demand']),
  B('competition', 'competition', 'DK2', 'full', 'market', ['validate.competitors']),
  B('funnel-validation', 'funnel', 'DK2', 'full', 'validation', ['validate.interviews', 'validate.strong_fit', 'validate.lois']),
  B('use-of-funds', 'use_of_funds', 'DK3', 'full', 'use_of_funds', ['raise.use_of_funds', 'raise.round_target']),
  B('round-terms-sparse', 'round_terms', 'DK3', 'sparse', 'round', ['raise.round_terms', 'raise.round_target'], ['records_only', 'fits', 'honest_gaps']),
  B('cap-table', 'cap_table', 'DK3', 'full', 'round', ['raise.cap_table', 'raise.vesting']),
  B('photo-solution', 'photo', 'DK4', 'full', 'solution', ['build.must_haves'], ['fits']),
  B('illustration-problem', 'illustration', 'DK4', 'sparse', 'problem', ['build.must_haves'], ['fits']),
]);

/** Keys a brief may carry. A prompt, instruction or free text is not one of them. */
export const BRIEF_KEYS = Object.freeze(['id', 'element', 'job', 'venture', 'card', 'records', 'expect']);

/**
 * A live element run spends money and calls models; it waits on the owner's
 * decision N (a monthly evaluation cap) and runs only against a staging
 * Worker. Returns the refusal sentence, or null when it may run.
 */
export function liveRefusal(env) {
  const cap = Number(env?.EVAL_SPEND_CAP_USD);
  if (!(Number.isFinite(cap) && cap > 0)) return 'A live run needs EVAL_SPEND_CAP_USD, the monthly cap the owner sets (decision N). Nothing was run.';
  if (!/^https:\/\//.test(String(env?.EVAL_BASE_URL ?? ''))) return 'A live run needs EVAL_BASE_URL, a staging Worker over https. Nothing was run.';
  if (/(^|\.)axal\.vc(\/|$)/.test(String(env.EVAL_BASE_URL).replace(/^https:\/\//, ''))) return 'A live run never targets production (axal.vc). Nothing was run.';
  return null;
}

// ── the two documents ─────────────────────────────────────────────────────

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/^`|`$/g, ''));

/** ELEMENT_EVAL.md's plan table: `| element | group | job | … |` rows → { element: job }. */
export function planJobsFrom(markdown) {
  const out = {};
  const block = String(markdown).split('<!-- plan-jobs:start -->')[1]?.split('<!-- plan-jobs:end -->')[0] ?? '';
  for (const line of block.split('\n')) {
    if (!/^\|/.test(line.trim()) || /^\|\s*-/.test(line.trim())) continue;
    const [element, , job] = cells(line);
    if (element && element !== 'Element') out[element] = job;
  }
  return out;
}

/** DECK_BENCHMARK.md's zero-edit baseline rows → { venture: { score, placeholders, overflow, pass } }. */
export function baselineFrom(markdown) {
  const out = {};
  const block = String(markdown).split('<!-- zero-edit:start -->')[1]?.split('<!-- zero-edit:end -->')[0] ?? '';
  for (const line of block.split('\n')) {
    if (!/^\|/.test(line.trim()) || /^\|\s*-/.test(line.trim())) continue;
    const [venture, score, placeholders, overflow, verdict] = cells(line);
    if (!venture || venture === 'Venture') continue;
    out[venture] = { score: Number(score), placeholders: Number(placeholders), overflow: Number(overflow), pass: /^pass/i.test(verdict) };
  }
  return out;
}

/** The zero-edit baseline table, as DECK_BENCHMARK.md holds it between its markers. */
export function baselineTable(rows) {
  const head = ['| Venture | Rubric v0 | "Not recorded" | Overflow | Verdict | ' + ZERO_EDIT_COMPARED.join(' | ') + ' |', '| --- | --- | --- | --- | --- |' + ZERO_EDIT_COMPARED.map(() => ' --- |').join('')];
  const body = Object.entries(rows).map(([v, r]) => `| ${v} | ${r.score} | ${r.placeholders} | ${r.overflow} | ${r.pass ? 'pass' : `fail: ${r.reasons.join('; ')}`} | ${ZERO_EDIT_COMPARED.map(() => 'not run (F)').join(' | ')} |`);
  return [...head, ...body].join('\n');
}
