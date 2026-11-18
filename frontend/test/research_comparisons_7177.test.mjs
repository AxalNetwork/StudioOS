/**
 * D7177 (#7177, canvas D7043 boards RS-15 · 0 to RS-15 F) — Research ›
 * Companies comparisons: both limits stated before any project is chosen,
 * Compare disabled with a visible reason, Review selection, save copy keyed to
 * the Worker's answer with one request id per Compare sheet, Check save status,
 * per-cell Unreadable, "Saved part-way", and the Table / By attribute layouts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_comparisons_7177.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import AddToResearch from '../src/pages/research/AddToResearch.jsx';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import { ReviewSelection, SelectionBar } from '../src/pages/research/CompanySelection.jsx';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import { researchProjectComparisonsApi } from '../src/lib/api/researchProjectComparisons.js';
import { cellView, comparisonError } from '../src/pages/research/researchComparisons.js';
import {
  LIMIT_LINE, columnPage, generatedTitle, partWay, saveOutcome, selectionRules, statusView, stepAttribute,
} from '../src/pages/research/comparisonSave.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: null }); }); await settle(m); };
const change = async (m, id, value) => { await act(async () => { m.props(byTid(m, id)).onChange({ target: { value } }); }); await settle(m); };
const submit = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onSubmit({ preventDefault() {} }); }); await settle(m); };
const fail = (status, code, data = {}) => Object.assign(new Error(code), { status, code, data: { detail: code, ...data } });

test('the selection rules: two limits, and a visible reason for each control that cannot act', () => {
  const at = (n) => selectionRules(n);
  // Mutation checked: let Compare take seven → canCompare is true at 7.
  assert.deepEqual([0, 1, 2, 6, 7, 25, 26].map((n) => at(n).canCompare), [false, false, true, true, false, false, false]);
  assert.deepEqual([0, 1, 25, 26].map((n) => at(n).canAdd), [false, true, true, false]);
  assert.equal(at(1).compareWhy, 'Select 2 to 6 to compare');
  assert.equal(at(7).compareWhy, 'Compare holds at most 6. Remove 1 to compare.');
  assert.equal(at(9).compareWhy, 'Compare holds at most 6. Remove 3 to compare.');
  assert.equal(at(6).compareNote, 'At the comparison limit');
  assert.equal(at(26).addWhy, 'Add to research takes up to 25. Remove 1.');
  assert.equal(LIMIT_LINE, 'Compare takes 2 to 6 companies · Add to research takes up to 25');
});

test('the generated title mirrors the Worker: whole names, " …" kept inside 160', () => {
  assert.equal(generatedTitle(['x'.repeat(100), 'y'.repeat(56), 'z']), `${'x'.repeat(100)} …`);
  assert.equal(generatedTitle(['A', 'B']), 'A · B');
  const long = ['Halden Grid Energy Storage Systems AS', 'Northwind Labs Logistics Software Inc.', 'Kestrel Robotics Industrial Automation GmbH', 'Quarry AI Developer Platforms Inc.'];
  assert.ok(generatedTitle(long).length <= 160);
});

test('a save’s answer decides the words: only a refusal or a confirmed rollback says nothing was added', () => {
  assert.equal(saveOutcome({ res: { item: { uid: 'k' }, repeat: true } }).repeat, true);
  // Mutation checked: ignore `rolled_back` → a 500 with rolled_back reads as unknown.
  assert.equal(saveOutcome({ err: fail(500, 'save_rolled_back', { rolled_back: true }) }).kind, 'rolled_back');
  assert.equal(saveOutcome({ err: fail(409, 'project_archived') }).kind, 'refused');
  assert.equal(saveOutcome({ err: fail(503, 'directory_unreadable') }).kind, 'refused');
  // Mutation checked: treat every 5xx as a refusal → these read refused.
  assert.equal(saveOutcome({ err: fail(503, 'save_outcome_unknown', { rolled_back: null }) }).kind, 'unknown');
  assert.equal(saveOutcome({ err: fail(500, 'boom') }).kind, 'unknown');
  assert.equal(saveOutcome({ err: new TypeError('Failed to fetch') }).kind, 'unknown');
  assert.equal(statusView({ res: { state: 'saved', item: { uid: 'k', title: 'T', members: 6 }, project: { title: 'P' } } }).kind, 'saved');
  assert.equal(statusView({ res: { state: 'not_found' } }).kind, 'not_found');
  // Mutation checked: read a failed status read as not found → this offers Try again.
  assert.equal(statusView({ err: new Error('down') }).kind, 'unreadable');
  assert.match(comparisonError({ code: 'too_many' }, 'f'), /up to 25/);
});

test('a cell the Worker could not read is Unreadable, never Not recorded', () => {
  const member = { state: 'listed', values: {} };
  // Mutation checked: drop the unreadable branch → the cell reads not_recorded.
  assert.deepEqual(cellView('employees', { status: 'unreadable', reason: 'Unreadable: the stored figure could not be read as a number' }, member),
    { state: 'unreadable', text: null, reason: 'Unreadable: the stored figure could not be read as a number' });
  assert.equal(cellView('size', { status: 'recorded', value: 1, currency: 'XYZ', source: {}, as_of: null }, member).state, 'unreadable');
});

test('Saved part-way: a short set and a doubled set are flagged; nothing else is', () => {
  const m = (uid) => ({ uid });
  const flags = partWay([
    { uid: 'a', kind: 'company', title: 'Full', members: [m('x'), m('y')] },
    { uid: 'b', kind: 'company', title: 'Short', members: [m('x')] },
    { uid: 'c', kind: 'company', title: 'Again', members: [m('x'), m('y')] },
    { uid: 'd', kind: 'company', title: 'Other order', members: [m('y'), m('x')] },
  ]);
  // Mutation checked: flag only empty sets → 'b' is not flagged.
  assert.deepEqual([...flags.keys()], ['b', 'c']);
  assert.match(flags.get('c').text, /same columns as “Full”/);
  assert.deepEqual(columnPage(6, 1), { page: 1, pages: 2, from: 3, to: 6 });
  assert.deepEqual([stepAttribute(0, -1, 7), stepAttribute(6, 1, 7)], [6, 0]);
});

function picks(n, page = 1) {
  return Array.from({ length: n }, (_, i) => ({ uid: `c${i}`, name: `Company ${i}`, page: i < 2 ? page + 1 : page, sector: 'Robotics', country: 'Norway' }));
}

test('the bar: seven selected keeps Add to research and disables Compare with its reason in visible text', async () => {
  const pressed = [];
  const m = await mountContracts(h(SelectionBar, { picks: picks(7), page: 1, onReview() {}, onClear() {}, onAdd: () => pressed.push('add'), onCompare: () => pressed.push('compare') }), '/research/companies');
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'selection-count')), /7 selected · 2 on other pages/);
    const compare = m.props(byTid(m, 'button-selection-compare'));
    // Mutation checked: use `disabled` (unfocusable, no reason) → aria-disabled is missing.
    assert.deepEqual([compare['aria-disabled'], compare['aria-describedby']], ['true', 'selection-why']);
    assert.match(textOf(byTid(m, 'selection-why')), /Remove 1 to compare/);
    assert.match(textOf(byTid(m, 'selection-limits')), /2 to 6.*up to 25/);
    await press(m, 'button-selection-compare');
    await press(m, 'button-selection-add');
    // Mutation checked: let the gated button act while aria-disabled → 'compare' is pressed.
    assert.deepEqual(pressed, ['add']);
  } finally { await m.unmount(); }
});

test('Review selection lists each pick with its page, marks the seventh over the limit, and removes by uid', async () => {
  const removed = [];
  const m = await mountContracts(h(ReviewSelection, { picks: picks(7), onRemove: (uid) => removed.push(uid), onClear() {}, onAdd() {}, onCompare() {}, onClose() {} }), '/research/companies');
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'review-c0')), /Company 0.*Robotics · Norway · page 2/);
    assert.match(textOf(byTid(m, 'review-c6')), /Over the limit/);
    assert.equal(/Over the limit/.test(textOf(byTid(m, 'review-c5'))), false);
    assert.match(textOf(byTid(m, 'review-over')), /7 selected — Compare holds 6/);
    assert.equal(m.props(byTid(m, 'button-review-compare'))['aria-disabled'], 'true');
    await press(m, 'button-review-remove-c6');
    assert.deepEqual(removed, ['c6']);
  } finally { await m.unmount(); }
});

const SIX = Array.from({ length: 6 }, (_, i) => ({ uid: `q-${i}`, name: `Company ${i}` }));
function mountSheet(api, items = SIX) {
  const real = { ...researchProjectsApi };
  const realCompared = { ...researchProjectComparisonsApi };
  const calls = [];
  Object.assign(researchProjectsApi, { list: async () => ({ items: [{ uid: 'p1', title: 'Climate shortlist', status: 'in_progress' }] }) });
  Object.assign(researchProjectComparisonsApi, Object.fromEntries(Object.entries(api).map(([k, fn]) => [k, async (...args) => { calls.push([k, ...args]); return fn(...args); }])));
  return mountContracts(h(AddToResearch, { kind: 'company', items, mode: 'compare', onClose() {} }), '/research/companies', { id: 1, role: 'founder' }).then((m) => ({
    m, calls, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectComparisonsApi, realCompared); },
  }));
}
const saved = { item: { uid: 'k1', title: 'Company 0 · Company 1', members: 6 }, project: { uid: 'p1', title: 'Climate shortlist' }, repeat: false, rolled_back: false };

test('Compare sheet: a confirmed rollback says nothing was added, and Try again sends the same request id', async () => {
  let n = 0;
  const { m, calls, restore } = await mountSheet({ create: async () => { n += 1; if (n === 1) throw fail(500, 'save_rolled_back', { rolled_back: true }); return saved; } });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'add-to-research-items')), /Company 0.*Company 5/);
    await act(async () => { m.props(byTid(m, 'research-target-p1')).onChange(); });
    await settle(m);
    await submit(m, 'form-add-to-research');
    const out = byTid(m, 'add-to-research-result');
    assert.equal(m.props(out)['data-outcome'], 'rolled_back');
    assert.match(textOf(out), /Not saved — nothing was added.*no comparison and no new companies in “Climate shortlist”.*6 companies are still selected/);
    await press(m, 'button-outcome-retry');
    assert.equal(calls.length, 2);
    // Mutation checked: mint a new request id per attempt → the two ids differ.
    assert.equal(calls[0][2].request_id, calls[1][2].request_id);
    assert.equal(m.props(byTid(m, 'add-to-research-result'))['data-outcome'], 'ok');
  } finally { await m.unmount(); restore(); }
});

test('Compare sheet: an unknown outcome offers Check save status, never “nothing was added” or a retry, until the read answers', async () => {
  let status = { state: 'not_found' };
  const { m, calls, restore } = await mountSheet({
    create: async () => { throw fail(503, 'save_outcome_unknown', { rolled_back: null }); },
    saveStatus: async () => { if (status === 'down') throw new Error('down'); return status; },
  });
  try {
    await settle(m);
    await act(async () => { m.props(byTid(m, 'research-target-p1')).onChange(); });
    await settle(m);
    await submit(m, 'form-add-to-research');
    const out = byTid(m, 'add-to-research-result');
    assert.equal(m.props(out)['data-outcome'], 'unknown');
    // Mutation checked: append "Nothing was added" to every failure → this matches.
    assert.equal(/nothing was added/i.test(textOf(out)), false);
    assert.equal(Boolean(byTid(m, 'button-outcome-retry')), false, 'no retry while the outcome is unknown');
    assert.equal(m.props(byTid(m, 'link-outcome-project')).href, '/research/projects/p1/comparisons');
    status = 'down';
    await press(m, 'button-outcome-check');
    assert.match(textOf(byTid(m, 'add-to-research-status')), /Unavailable.*Couldn’t check the save/);
    assert.equal(Boolean(byTid(m, 'button-outcome-retry')), false);
    status = { state: 'not_found' };
    await press(m, 'button-outcome-check');
    assert.match(textOf(byTid(m, 'add-to-research-status')), /Not saved — safe to try again/);
    const id = calls.find((c) => c[0] === 'create')[2].request_id;
    assert.deepEqual(calls.filter((c) => c[0] === 'saveStatus').map((c) => c[1]), [id, id], 'the status read asks for this sheet’s request id');
    status = { state: 'saved', ...saved };
    await press(m, 'button-outcome-retry');
    assert.equal(calls.filter((c) => c[0] === 'create').every((c) => c[2].request_id === id), true);
  } finally { await m.unmount(); restore(); }
});

test('Compare sheet: a refusal before any write says so and lets the member choose another project', async () => {
  const { m, restore } = await mountSheet({ create: async () => { throw fail(409, 'project_archived'); } });
  try {
    await settle(m);
    await act(async () => { m.props(byTid(m, 'research-target-p1')).onChange(); });
    await settle(m);
    await submit(m, 'form-add-to-research');
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Refused before saving — nothing was added.*archived.*6 companies stay selected/);
    await press(m, 'button-outcome-back');
    assert.equal(Boolean(byTid(m, 'add-to-research-result')), false);
    assert.ok(byTid(m, 'button-add-to-research-confirm'));
  } finally { await m.unmount(); restore(); }
});

test('Compare sheet: a new project is made in the same request as the comparison, and not offered past the limit', async () => {
  const { m, calls, restore } = await mountSheet({ createWithProject: async () => saved });
  try {
    await settle(m);
    await act(async () => { m.props(byTid(m, 'research-target-new')).onChange(); });
    await settle(m);
    assert.equal(m.props(byTid(m, 'button-add-to-research-confirm')).disabled, true, 'a question is needed first');
    await change(m, 'input-compare-project-question', 'Which grid companies raised a Series A?');
    await submit(m, 'form-add-to-research');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'createWithProject');
    assert.deepEqual(calls[0][1].project, { question: 'Which grid companies raised a Series A?' });
    assert.deepEqual(calls[0][1].uids, SIX.map((x) => x.uid));
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Comparison saved/);
  } finally { await m.unmount(); restore(); }
  const seven = await mountSheet({ createWithProject: async () => saved }, [...SIX, { uid: 'q-6', name: 'Company 6' }]);
  try {
    await settle(seven.m);
    // Mutation checked: leave New research project enabled → it is not disabled with seven.
    assert.equal(seven.m.props(byTid(seven.m, 'research-target-new')).disabled, true);
  } finally { await seven.m.unmount(); seven.restore(); }
});

const WIKI = { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1' };
const rec = (value) => ({ status: 'recorded', value, source: WIKI, as_of: '2026-09-30' });
const member = (uid, name, employees) => ({
  kind: 'company', uid, name, state: 'listed', comparisons: 1,
  values: { country: rec('Norway'), sector: rec('Robotics'), founded: rec(2020), employees, last_round: { status: 'not_recorded', reason: 'Not recorded: no source lists it for this company' }, funding_total: rec(1), revenue: rec(1) },
});
const ATTRS = [['country', 'Country'], ['sector', 'Sector'], ['founded', 'Founded'], ['employees', 'Employees'], ['last_round', 'Last round'], ['funding_total', 'Total funding'], ['revenue', 'Revenue']].map(([key, label]) => ({ key, label }));
const FOUR = [member('a', 'Alpha', rec(40)), member('b', 'Beta', { status: 'unreadable', reason: 'Unreadable: the stored figure could not be read as a number' }), member('c', 'Gamma', rec(9)), member('d', 'Delta', rec(12))];
const COMPARED = {
  project: { uid: 'p1', status: 'in_progress' }, directory: { company: 'ok', fund: 'ok' }, attributes: { company: ATTRS, fund: [] },
  limits: { members: 6, add: 25, title: 160 },
  subjects: FOUR.map(({ values, ...s }) => s),
  comparisons: [
    { uid: 'k1', kind: 'company', title: 'Four', created_at: '', updated_at: '', members: FOUR },
    { uid: 'k2', kind: 'company', title: 'One', created_at: '', updated_at: '', members: [FOUR[0]] },
  ],
};
const PROJECT = { uid: 'p1', title: 'Climate shortlist', question: 'Q', objective: null, scope: null, exclusions: null, status: 'in_progress', archived_at: null, created_at: '', updated_at: '' };

async function mountTab() {
  const real = { ...researchProjectsApi };
  const realFindings = { ...researchProjectFindingsApi };
  const realCompared = { ...researchProjectComparisonsApi };
  Object.assign(researchProjectsApi, { read: async () => ({ item: PROJECT, evidence: [], passages_unattributed: 0, collections: [], sessions: [], answers: [] }) });
  Object.assign(researchProjectFindingsApi, { list: async () => ({ items: [], proposals: [] }) });
  Object.assign(researchProjectComparisonsApi, { list: async () => COMPARED });
  const tree = h(Routes, null, h(Route, { path: '/research/projects/:uid/comparisons', element: h(ResearchProject, { tab: 'comparisons' }) }));
  const m = await mountContracts(tree, '/research/projects/p1/comparisons', { id: 1, role: 'founder' });
  return { m, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectFindingsApi, realFindings); Object.assign(researchProjectComparisonsApi, realCompared); } };
}

test('the comparison: Unreadable per cell with Retry, Saved part-way, the tablet pager and By attribute', async () => {
  const { m, restore } = await mountTab();
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'cell-k1-employees-b')), /^Unreadable.*could not be read as a number.*Retry/);
    // Mutation checked: drop the part-way flag → partway-k2 is missing.
    assert.match(textOf(byTid(m, 'partway-k2')), /Saved part-way\..*1 column/);
    assert.equal(Boolean(byTid(m, 'partway-k1')), false);
    // The tablet shows three columns and the attribute column: the fourth is hidden below 1024px.
    const heads = m.nodes().filter((n) => n.tagName === 'TH' && m.props(n)?.scope === 'col');
    const delta = heads.find((n) => /Delta/.test(textOf(n)));
    // Mutation checked: page by four → Delta is on the first page.
    assert.match(m.props(delta).className, /sm:hidden lg:table-cell/);
    assert.match(textOf(byTid(m, 'column-pager-k1')), /Companies 1–3 of 4/);
    assert.match(m.props(byTid(m, 'button-columns-next-k1'))['aria-label'], /Next companies: Delta/);
    await press(m, 'button-columns-next-k1');
    assert.equal(/sm:hidden/.test(m.props(m.nodes().filter((n) => n.tagName === 'TH' && m.props(n)?.scope === 'col').find((n) => /Delta/.test(textOf(n)))).className || ''), false);
    // The phone reads one attribute across every company; the stepper names the next attribute.
    assert.match(textOf(byTid(m, 'attr-row-phone-k1-b')), /Beta.*Norway.*Wikidata · as of 2026-09-30/);
    assert.equal(m.props(byTid(m, 'button-attr-next-phone-k1'))['aria-label'], 'Next attribute: Sector');
    assert.equal(m.props(byTid(m, 'button-attr-prev-phone-k1'))['aria-label'], 'Previous attribute: Revenue');
    await press(m, 'button-attr-next-phone-k1');
    assert.match(textOf(byTid(m, 'attr-row-phone-k1-a')), /Alpha.*Robotics/);
    await change(m, 'select-attr-phone-k1', '3');
    assert.match(textOf(byTid(m, 'attr-row-phone-k1-b')), /Beta.*Unreadable/);
    assert.match(textOf(byTid(m, 'attr-row-phone-k1-a')), /Alpha.*40/);
    // Table or By attribute from a tablet up.
    await press(m, 'layout-k1-attribute');
    assert.ok(byTid(m, 'comparison-attribute-wide-k1'));
  } finally { await m.unmount(); restore(); }
});
