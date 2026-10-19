/**
 * D697 (#1659) test 11 — the census. Every feature `FounderValidateWorkspace`
 * (FVW) drew on `/validate/interviews`, `/validate/pain-map` and
 * `/validate/hypotheses`, and the verdict zone's As of last week and Changed
 * this month with their note, each with its new home and a check.
 *
 * The inventory is written here, from #1659's Problem section, and never read
 * from FVW, so the census still passes after #1666 deletes FVW.
 *   - A home in this task: the component draws the feature by name.
 *   - A home in another task: the named file carries a marker. The theme and
 *     hypothesis records' actions (#1692) are checked against their writers on
 *     `main` (`services/validateWriters.ts`, #1759); #1692's closing PR
 *     declares them on the records.
 *   - A view that is the cleared filter says so.
 * The test fails if a feature has no entry, or an entry's check fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_census_d697.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { InterviewsSection, PainThemesSection, HypothesesSection } from '../src/pages/cycles/ValidateSections.jsx';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { RECORDS } from '../src/pages/cycles/adapters/validate.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};

const sections = {
  interviews: ssr(h(InterviewsSection, { parts: { can_write: true, stats: { logged: 3, with_pain: 2, consent_agreed: 1, consent_not_asked: 1 } }, openDialog: noop, onLog: noop, onExport: noop })),
  pain: ssr(h(PainThemesSection, { parts: {
    can_write: true, stats: { themes: 2, interviews: 3, ungrouped: 1, need_themes: 1, icp_themes: 1, fit_unrecorded_themes: 0 },
    themes: [{ id: 1, title: 'Late invoices' }], unthemed: [{ interview_id: 4, interviewee: 'Rowan Vale', date: '2026-10-02', phrase: 'chasing payments' }], unthemed_total: 1,
  }, onExport: noop, onAssign: noop })),
  hypotheses: (filter = {}) => ssr(h(HypothesesSection, { parts: {
    can_write: true, stats: { hypotheses: 2, supported: 1, refuted: 0, awaiting: 1, withheld: 1, fit_not_recorded: 2, bar: 5, history_since: '2999-01-01T00:00:00Z' },
    fit_gap: [{ id: 1, code: 'H1', supporting: 1, bar: 5, fit_unrecorded: 1 }],
  }, projectId: 7, query: { filter }, openDialog: noop, onLoadLinkLists: noop, onLink: noop, onNewHypothesis: noop })),
};
// Labels as the read sends them, so the adapter applies its fallback lists (an empty `cols` passes through untouched).
const filters = (slug) => adaptRecords('validate', slug, { cols: ['Name'], rows: [] });
const option = (slug, key, value) => filters(slug).filters.find((f) => f.key === key)?.options.some((o) => o.value === value) === true;
const writers = read('cloudflare-worker/src/services/validateWriters.ts');
// The writer names, read once with a literal pattern; a census row looks its name up.
const WRITERS = new Set([...writers.matchAll(/export async function (\w+)\b/g)].map((m) => m[1]));
const writer = (name) => WRITERS.has(name);
const record = read('frontend/src/pages/founder/InterviewReviewPage.jsx');
const model = read('frontend/src/pages/founder/interviewReviewModel.js');
const sectionsSrc = read('frontend/src/pages/cycles/ValidateSections.jsx');
const worker = read('cloudflare-worker/src/services/cycleValidate.ts');

/** The inventory, from #1659's Problem section: page › feature. */
const FEATURES = [
  // /validate/interviews
  'Interviews › Log an interview', 'Interviews › ?new=notes|upload', 'Interviews › Export interviews',
  'Interviews › Interviews logged', 'Interviews › With a pain recorded', 'Interviews › Consent to quote', 'Interviews › Deck-eligible',
  'Interviews › view All', 'Interviews › view Deck-eligible', 'Interviews › view Strong fit', 'Interviews › view Not ICP', 'Interviews › Stage',
  'Interviews › the pains count', 'Interviews › Record a session', 'Interviews › attach audio and Transcribe',
  'Interviews › ICP fit, consent and company', 'Interviews › Need/Nice per pain', 'Interviews › the Marketplace and Advisory card',
  // /validate/pain-map
  'Pain map › chip ICP only', 'Pain map › chip All interviews', 'Pain map › chip Need-to-have', 'Pain map › chip By recency',
  'Pain map › Open the Problem slide', 'Pain map › Export map',
  'Pain map › Themes', 'Pain map › Interviews behind them', 'Pain map › Ungrouped phrases', 'Pain map › Need-to-have themes', 'Pain map › Themes your ICP named',
  'Pain map › per theme: interviews and %', 'Pain map › per theme: wordings', 'Pain map › per theme: need and nice counts',
  'Pain map › per theme: ICP and fit ? counts', 'Pain map › per theme: the latest mention', 'Pain map › the ungrouped-phrases note',
  'Pain map › Merge', 'Pain map › Split', 'Pain map › Rename', 'Pain map › Delete', 'Pain map › Attach a quote', 'Pain map › Link',
  // /validate/hypotheses
  'Hypotheses › New hypothesis', 'Hypotheses › Link to a pain', 'Hypotheses › Unlink', 'Hypotheses › Retire or Restore',
  'Hypotheses › view All', 'Hypotheses › view Blocking the verdict', 'Hypotheses › view Recently moved', 'Hypotheses › view Retired',
  'Hypotheses › the history-seam sentence', 'Hypotheses › Hypotheses', 'Hypotheses › Awaiting evidence', 'Hypotheses › Bar per claim',
  'Hypotheses › Verdict withheld', 'Hypotheses › FitGap', 'Hypotheses › Validated, Invalidated and Unproven',
  // /validate/verdict's two history views
  'Verdict › As of last week', 'Verdict › Changed this month', 'Verdict › the history note', 'Verdict › Verdict from the recorded history',
];

/** Each feature's home, and the check that it is there. */
const CENSUS = {
  'Interviews › Log an interview': ['Customer research section', () => /Log an interview/.test(sections.interviews)],
  'Interviews › ?new=notes|upload': ['Customer research section, as ?log= (#1666 redirects ?new=)', () => /const LOG_INTENTS = \['notes', 'upload'\]/.test(sectionsSrc)],
  'Interviews › Export interviews': ['Customer research section', () => /Export interviews/.test(sections.interviews)],
  'Interviews › Interviews logged': ['Customer research section strip', () => />Interviews logged</.test(sections.interviews)],
  'Interviews › With a pain recorded': ['Customer research section strip', () => />With a pain recorded</.test(sections.interviews)],
  'Interviews › Consent to quote': ['Customer research section strip', () => />Consent to quote</.test(sections.interviews) && /never asked — not the same as declined/.test(sections.interviews)],
  'Interviews › Deck-eligible': ['Customer research section strip', () => />Deck-eligible</.test(sections.interviews)],
  'Interviews › view All': ['the cleared filter: no chip chosen', () => !filters('customer-research').filters.some((f) => f.options.some((o) => /^All/.test(o.label)))],
  'Interviews › view Deck-eligible': ['the Consent filter\'s Agreed · deck-eligible', () => filters('customer-research').filters.find((f) => f.key === 'consent').options.some((o) => o.label === 'Agreed · deck-eligible')],
  'Interviews › view Strong fit': ['the ICP fit filter\'s Strong', () => option('customer-research', 'icp', 'strong')],
  'Interviews › view Not ICP': ['the ICP fit filter\'s None', () => option('customer-research', 'icp', 'none')],
  'Interviews › Stage': ['State, the table\'s last column (#1691)', () => RECORDS['customer-research'].keys.includes('state') && !filters('customer-research').filters.some((f) => f.key === 'stage')],
  'Interviews › the pains count': ['the record\'s What it fed (#1692)', () => /'what it fed'/.test(model)],
  'Interviews › Record a session': ['the record\'s tools', () => /\/validate\/record\?interview=\$\{encodeURIComponent\(row\.id\)\}&project_id=/.test(record)],
  'Interviews › attach audio and Transcribe': ['the record\'s tools', () => /<InterviewRecording interview=\{row\}/.test(record)],
  'Interviews › ICP fit, consent and company': ['the record\'s tools', () => /<InterviewEvidenceFields fit=\{row\.icp_fit\}/.test(record)],
  'Interviews › Need/Nice per pain': ['the record\'s tools', () => /<PainSeverity interviewId=\{row\.id\}/.test(record)],
  'Interviews › the Marketplace and Advisory card': ['Customer research section, More tools', () => /More tools/.test(sections.interviews) && /\/build\/marketplace/.test(sections.interviews) && /\/advisory/.test(sections.interviews)],

  'Pain map › chip ICP only': ['the Problem discovery filter ICP only', () => option('problem-discovery', 'icp', 'yes')],
  'Pain map › chip All interviews': ['the cleared filter: no chip chosen', () => !filters('problem-discovery').filters.some((f) => f.options.some((o) => /^All/.test(o.label)))],
  'Pain map › chip Need-to-have': ['the Problem discovery filter Need-to-have', () => option('problem-discovery', 'need', 'yes')],
  'Pain map › chip By recency': ['the sort Most recent', () => filters('problem-discovery').sorts.some((s) => s.key === 'recent' && s.label === 'Most recent')],
  'Pain map › Open the Problem slide': ['Problem discovery section', () => /Open the Problem slide/.test(sections.pain)],
  'Pain map › Export map': ['Problem discovery section', () => /Export map/.test(sections.pain)],
  'Pain map › Themes': ['Problem discovery section strip', () => />Themes</.test(sections.pain)],
  'Pain map › Interviews behind them': ['Problem discovery section strip', () => />Interviews behind them</.test(sections.pain)],
  'Pain map › Ungrouped phrases': ['Problem discovery section strip', () => />Ungrouped phrases</.test(sections.pain)],
  'Pain map › Need-to-have themes': ['Problem discovery section strip', () => />Need-to-have themes</.test(sections.pain)],
  'Pain map › Themes your ICP named': ['Problem discovery section strip', () => />Themes your ICP named</.test(sections.pain)],
  'Pain map › per theme: interviews and %': ['the table\'s Mentions column', () => RECORDS['problem-discovery'].keys.includes('mentions')],
  'Pain map › per theme: wordings': ['the theme row\'s wordings, for the theme record (#1692, #1658)', () => /wordings/.test(worker)],
  'Pain map › per theme: need and nice counts': ['the table\'s Severity column and the theme row\'s counts', () => RECORDS['problem-discovery'].keys.includes('severity') && /need_count/.test(worker)],
  'Pain map › per theme: ICP and fit ? counts': ['the theme row\'s ICP counts (#1691)', () => /icp_count/.test(worker) && /fit_unrecorded_count/.test(worker)],
  'Pain map › per theme: the latest mention': ['the sort Most recent, by last_mention_at', () => /last_mention_at/.test(worker)],
  'Pain map › the ungrouped-phrases note': ['Problem discovery section, the unthemed quotes', () => /Unthemed quotes · 1/.test(sections.pain)],
  'Pain map › Merge': ['the theme record\'s merge (#1692)', () => writer('mergeTheme')],
  'Pain map › Split': ['the theme record\'s split (#1692)', () => writer('splitTheme')],
  'Pain map › Rename': ['the theme record\'s Edit (#1692)', () => writer('updateTheme')],
  'Pain map › Delete': ['the theme record\'s Delete (#1692)', () => writer('deleteTheme')],
  'Pain map › Attach a quote': ['Problem discovery section\'s Assign, and the theme record\'s attach (#1692)', () => writer('attachQuote') && /Assign to a theme/.test(sections.pain)],
  'Pain map › Link': ['the theme record\'s link (#1692)', () => writer('linkTheme')],

  'Hypotheses › New hypothesis': ['Experiments section, until #1656 registers its form', () => /New hypothesis/.test(sections.hypotheses())],
  'Hypotheses › Link to a pain': ['Experiments section', () => /Link to a pain/.test(sections.hypotheses())],
  'Hypotheses › Unlink': ['the hypothesis record\'s unlink (#1692)', () => writer('unlinkEvidence')],
  'Hypotheses › Retire or Restore': ['the hypothesis record\'s Edit (#1692), which takes retired', () => /retired must be true or false/.test(writers)],
  'Hypotheses › view All': ['the cleared filter: no chip chosen', () => !filters('experiments').filters.some((f) => f.options.some((o) => /^All/.test(o.label)))],
  'Hypotheses › view Blocking the verdict': ['the Status filter\'s Fit not recorded', () => filters('experiments').filters.find((f) => f.key === 'status').options.some((o) => o.value === 'not_recorded' && o.label === 'Fit not recorded')],
  'Hypotheses › view Recently moved': ['the filter Recently moved', () => option('experiments', 'moved', 'recent')],
  'Hypotheses › view Retired': ['the Status filter\'s Retired', () => option('experiments', 'status', 'retired')],
  'Hypotheses › the history-seam sentence': ['Experiments section, under Recently moved', () => /Lane history starts 2999-01-01, so moves before that are not on record\./.test(sections.hypotheses({ moved: 'recent' }))],
  'Hypotheses › Hypotheses': ['Experiments section strip', () => />Hypotheses</.test(sections.hypotheses())],
  'Hypotheses › Awaiting evidence': ['Experiments section strip', () => />Awaiting evidence</.test(sections.hypotheses())],
  'Hypotheses › Bar per claim': ['Experiments section strip', () => />Bar per claim</.test(sections.hypotheses())],
  'Hypotheses › Verdict withheld': ['Experiments section strip', () => />Verdict withheld</.test(sections.hypotheses())],
  'Hypotheses › FitGap': ['Experiments section, the fit line', () => /no ICP fit recorded\. Those cannot count toward a hypothesis/.test(sections.hypotheses())],
  'Hypotheses › Validated, Invalidated and Unproven': ['not drawn: the module\'s one vocabulary (decision 10)', () => !/Validated|Invalidated|Unproven/.test([sections.interviews, sections.pain, sections.hypotheses()].join(''))],

  'Verdict › As of last week': ['the Experiments History filter', () => option('experiments', 'history', 'last_week')],
  'Verdict › Changed this month': ['the Experiments History filter', () => option('experiments', 'history', 'this_month')],
  'Verdict › the history note': ['Experiments section, under either view', () => /Status history starts 2999-01-01\./.test(sections.hypotheses({ history: 'last_week' })) && /Status history starts 2999-01-01\./.test(sections.hypotheses({ history: 'this_month' }))],
  'Verdict › Verdict from the recorded history': ['Experiments section, under As of last week', () => /Status from the recorded history · counts are current/.test(sections.hypotheses({ history: 'last_week' }))],
};

test('11: every FVW Interviews, Pain map and Hypotheses feature, and the verdict zone\'s two views, has an entry', () => {
  const missing = FEATURES.filter((f) => !Object.prototype.hasOwnProperty.call(CENSUS, f));
  assert.deepEqual(missing, [], 'a feature with no home');
  const extra = Object.keys(CENSUS).filter((f) => !FEATURES.includes(f));
  assert.deepEqual(extra, [], 'an entry for no listed feature');
});

for (const feature of FEATURES) {
  test(`11: ${feature} → ${CENSUS[feature]?.[0] ?? 'no home'}`, () => {
    assert.ok(CENSUS[feature], 'has an entry');
    assert.equal(CENSUS[feature][1](), true, `its check holds: ${CENSUS[feature][0]}`);
  });
}
