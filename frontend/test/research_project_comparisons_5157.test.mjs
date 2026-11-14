/**
 * D5157 part 3 (#5157) — a Research Project's Comparisons tab (RS-02 D) and
 * Add to research / Compare from Companies and Funds (RS-04, RS-05): values
 * with their source and date, Not recorded and Unreadable kept apart, a
 * comparison made from a selection of one kind, and honest states (an
 * unreadable read is never an empty list, a missing count is never 0).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_project_comparisons_5157.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResearchProject from '../src/pages/research/ResearchProject.jsx';
import AddToResearch from '../src/pages/research/AddToResearch.jsx';
import { DirectoryTable } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { FundDirectoryView } from '../src/pages/research/FundDirectory.jsx';
import { researchProjectsApi } from '../src/lib/api/researchProjects.js';
import { researchProjectFindingsApi } from '../src/lib/api/researchProjectFindings.js';
import { researchProjectComparisonsApi } from '../src/lib/api/researchProjectComparisons.js';
import {
  addOutcome, canAddToResearch, cellView, comparisonError, comparisonsBadge, comparisonsView,
} from '../src/pages/research/researchComparisons.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const ok = (value) => ({ status: 'ok', value });
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const settle = async (m) => { for (let i = 0; i < 6; i += 1) await m.flush(); };
const press = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: null }); }); await settle(m); };
const change = async (m, id, value) => { await act(async () => { m.props(byTid(m, id)).onChange({ target: { value } }); }); await settle(m); };
const submit = async (m, id) => { await act(async () => { m.props(byTid(m, id)).onSubmit({ preventDefault() {} }); }); await settle(m); };

const WIKI = { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1' };
const NR = (reason = 'Not recorded: the directory holds no value') => ({ status: 'not_recorded', reason });
const NEBULA = {
  kind: 'company', uid: 'q-nebula', name: 'Nebula Compute', state: 'listed', added_at: '2026-11-12 10:00:00', comparisons: 1,
  values: {
    country: { status: 'recorded', value: 'Norway', source: WIKI, as_of: '2026-09-30' },
    sector: { status: 'recorded', value: 'GPU cloud', source: WIKI, as_of: '2026-09-30' },
    founded: { status: 'recorded', value: 2021, source: WIKI, as_of: '2026-09-30' },
    employees: { status: 'recorded', value: 40, source: { name: 'Company filing', url: null }, as_of: '2026-06-01' },
    last_round: { status: 'recorded', value: 2500000, currency: 'EUR', type: 'Seed', date: '2025-06-01', source: { name: 'Company filing', url: null }, as_of: '2025-06-01' },
    funding_total: NR('Not recorded: no source lists it for this company'),
    revenue: NR('Not recorded: no source lists it for this company'),
  },
};
const GONE = { kind: 'company', uid: 'q-fjord', name: 'Fjord Data', state: 'removed', added_at: '2026-11-12 10:00:00', comparisons: 1, values: null };
const ATTRS = {
  company: [['country', 'Country'], ['sector', 'Sector'], ['founded', 'Founded'], ['employees', 'Employees'], ['last_round', 'Last round'], ['funding_total', 'Total funding'], ['revenue', 'Revenue']].map(([key, label]) => ({ key, label })),
  fund: [['hq', 'Headquarters'], ['size', 'Fund size']].map(([key, label]) => ({ key, label })),
};
const strip = ({ values, ...s }) => s;
const COMPARED = {
  project: { uid: 'p1', status: 'in_progress' },
  directory: { company: 'ok', fund: 'ok' },
  attributes: ATTRS,
  limits: { members: 6, add: 25, title: 160 },
  subjects: [strip(NEBULA), strip(GONE), { kind: 'company', uid: 'q-aster', name: 'Aster Cloud', state: 'listed', comparisons: 0 }, { kind: 'fund', uid: 'northwind', name: 'Northwind Seed', state: 'listed', comparisons: 0 }],
  comparisons: [{ uid: 'k1', kind: 'company', title: 'Independent EU GPU providers', created_at: '2026-11-12 10:00:00', updated_at: '2026-11-12 10:00:00', members: [NEBULA, GONE] }],
};
const PROJECT = { uid: 'p1', title: 'European AI Infrastructure', question: 'Q', objective: null, scope: null, exclusions: null, status: 'in_progress', archived_at: null, created_at: '2026-11-08 10:00:00', updated_at: '2026-11-12 10:00:00' };
const READ = { item: PROJECT, evidence: [], passages_unattributed: 0, collections: [], sessions: [], answers: [] };

test('a cell names its source and date; Not recorded keeps its reason; a removed column shows nothing', () => {
  const view = comparisonsView(ok(COMPARED));
  const set = view.comparisons[0];
  const row = (key) => set.rows.find((r) => r.key === key).cells;
  assert.deepEqual(row('last_round')[0], { state: 'recorded', text: 'EUR 2.5M', detail: 'Seed · 2025-06-01', source: 'Company filing · as of 2025-06-01', sourceUrl: null });
  assert.equal(row('country')[0].source, 'Wikidata · as of 2026-09-30');
  // Mutation checked: draw a not_recorded cell as recorded (or as 0) → its text is not "Not recorded".
  assert.deepEqual([row('revenue')[0].state, row('revenue')[0].text, row('revenue')[0].reason], ['not_recorded', 'Not recorded', 'Not recorded: no source lists it for this company']);
  // Mutation checked: read a removed member's values → its cells are not 'absent'.
  assert.deepEqual(row('country')[1], { state: 'absent', text: null, reason: 'No longer in the directory, so nothing is shown for it.' });
  assert.equal(cellView('country', null, { state: 'listed', values: {} }).state, 'unreadable');
  assert.equal(cellView('country', null, { state: 'unreadable', values: null }).reason, 'Unreadable: the directory could not be read just now.');
  assert.equal(cellView('size', { status: 'recorded', value: 5000000000, currency: 'EUR', source: { name: 'List', url: null }, as_of: null }, { state: 'listed', values: {} }).text, '€50M');
  assert.equal(cellView('size', { status: 'recorded', value: 5000000000, currency: 'EUR', source: { name: 'List', url: null }, as_of: null }, { state: 'listed', values: {} }).source, 'List · date not recorded');
  // The candidates for a new column are the project's own of the same kind, not already in it.
  assert.deepEqual(set.candidates.map((s) => s.uid), ['q-aster']);
  assert.deepEqual(set.members.map((m) => m.href), ['/research/companies/company/q-nebula', '/research/companies/company/q-fjord']);
});

test('the view and the badge: no number while the read is not ok, and a code is read from err.code', () => {
  assert.equal(comparisonsView({ status: 'loading' }).state, 'loading');
  assert.equal(comparisonsView({ status: 'failed' }).state, 'unreadable');
  // Mutation checked: badge a failed read as 0 → this is 0.
  assert.equal(comparisonsBadge({ status: 'failed' }), null);
  assert.equal(comparisonsBadge(ok(COMPARED)), 1);
  assert.equal(comparisonsBadge(ok({ subjects: [], comparisons: [] })), 0);
  assert.equal(comparisonsView(ok({ subjects: [], comparisons: [] })).empty, true);
  assert.match(comparisonError({ code: 'comparison_full', message: 'x' }, 'f'), /at most 6/);
  assert.equal(comparisonError({ message: 'comparison_full' }, 'f'), 'comparison_full', 'a code is never matched through the message (D258)');
  assert.equal(addOutcome(['Nebula Compute'], 'EU', { added: 1, already: 0 }), 'Added Nebula Compute to “EU”.');
  assert.equal(addOutcome(['Nebula Compute'], 'EU', { added: 0, already: 1 }), 'Nebula Compute is already in “EU”.');
  assert.equal(addOutcome(['A', 'B', 'C'], 'EU', { added: 2, already: 1 }), 'Added 2 to “EU”; 1 was already there.');
  // Only a shell with My Research offers Add to research.
  assert.deepEqual(['founder', 'admin', 'investor', 'advisor', 'partner', undefined].map(canAddToResearch), [true, true, false, false, false, false]);
});

function mount(path, comparisons = {}, project = {}) {
  const real = { ...researchProjectsApi };
  const realFindings = { ...researchProjectFindingsApi };
  const realCompared = { ...researchProjectComparisonsApi };
  Object.assign(researchProjectsApi, { read: async () => READ, ...project });
  Object.assign(researchProjectFindingsApi, { list: async () => ({ items: [], proposals: [] }) });
  Object.assign(researchProjectComparisonsApi, { list: async () => COMPARED, ...comparisons });
  const tree = h(Routes, null,
    h(Route, { path: '/research/projects/:uid', element: h(ResearchProject, { tab: 'overview' }) }),
    h(Route, { path: '/research/projects/:uid/comparisons', element: h(ResearchProject, { tab: 'comparisons' }) }));
  return mountContracts(tree, path, { id: 1, role: 'founder' }).then((m) => ({
    m, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectFindingsApi, realFindings); Object.assign(researchProjectComparisonsApi, realCompared); },
  }));
}

test('Comparisons tab: a table with row headers, each value with its source, and a removed column said by name', async () => {
  const { m, restore } = await mount('/research/projects/p1/comparisons');
  try {
    await settle(m);
    assert.equal(textOf(byTid(m, 'project-tab-count-comparisons')), '1');
    const table = byTid(m, 'comparison-table-k1');
    assert.ok(table);
    assert.match(textOf(table), /Attribute.*Nebula Compute.*Fjord Data.*No longer in the directory.*Country.*Norway.*Wikidata · as of 2026-09-30/);
    assert.match(textOf(byTid(m, 'cell-k1-last_round-q-nebula')), /EUR 2\.5M.*Seed · 2025-06-01.*Company filing · as of 2025-06-01/);
    assert.match(textOf(byTid(m, 'cell-k1-revenue-q-nebula')), /^Not recorded/);
    assert.equal(m.nodes().filter((n) => n.tagName === 'TH' && m.props(n)?.scope === 'row').length, ATTRS.company.length, 'every attribute is a row header');
    assert.match(textOf(byTid(m, 'project-subjects')), /Companies.*Nebula Compute.*in 1 comparison.*Fjord Data.*No longer in the directory.*Funds.*Northwind Seed/);
    // The bar's Compare opens this tab, so it is not drawn on it.
    assert.equal(Boolean(byTid(m, 'button-project-compare')), false);
  } finally { await m.unmount(); restore(); }
  const r = await mount('/research/projects/p1');
  try {
    await settle(r.m);
    assert.equal(r.m.props(byTid(r.m, 'button-project-compare')).href, '/research/projects/p1/comparisons');
    assert.equal(r.m.props(byTid(r.m, 'project-tab-comparisons')).href, '/research/projects/p1/comparisons');
  } finally { await r.m.unmount(); r.restore(); }
});

test('Comparisons tab: an unreadable read says Unavailable with Retry, never No comparisons yet, and no badge', async () => {
  let fail = true;
  let calls = 0;
  const { m, restore } = await mount('/research/projects/p1/comparisons', { list: async () => { calls += 1; if (fail) throw new Error('down'); return { subjects: [], comparisons: [] }; } });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'comparisons-unreadable')), /Unavailable/);
    // Mutation checked: draw the empty state for a failed read → comparisons-empty appears here.
    assert.equal(Boolean(byTid(m, 'comparisons-empty')), false);
    assert.equal(Boolean(byTid(m, 'project-tab-count-comparisons')), false, 'no badge without a read');
    fail = false;
    await press(m, 'button-comparisons-retry');
    assert.equal(calls, 2);
    assert.match(textOf(byTid(m, 'comparisons-empty')), /No comparisons yet/);
    assert.equal(textOf(byTid(m, 'project-tab-count-comparisons')), '0');
  } finally { await m.unmount(); restore(); }
});

test('Comparisons tab: Compare sends one kind of ticked subjects; Delete asks first; a column is removed by its uid', async () => {
  const created = [];
  const removed = [];
  const columns = [];
  const { m, restore } = await mount('/research/projects/p1/comparisons', {
    create: async (uid, body) => { created.push([uid, body]); return { item: { uid: 'k2' } }; },
    remove: async (uid, k) => { removed.push([uid, k]); return { ok: true }; },
    removeMember: async (uid, k, member) => { columns.push([uid, k, member]); return { ok: true }; },
  });
  try {
    await settle(m);
    await act(async () => { m.props(byTid(m, 'pick-company-q-nebula')).onChange(); });
    await act(async () => { m.props(byTid(m, 'pick-company-q-aster')).onChange(); });
    // Ticking a fund starts a new selection: a comparison holds one kind.
    await act(async () => { m.props(byTid(m, 'pick-fund-northwind')).onChange(); });
    await act(async () => { m.props(byTid(m, 'pick-company-q-nebula')).onChange(); });
    await act(async () => { m.props(byTid(m, 'pick-company-q-aster')).onChange(); });
    await settle(m);
    await change(m, 'input-new-comparison-title', ' Two clouds ');
    await submit(m, 'form-new-comparison');
    // Mutation checked: keep the fund in a mixed selection → uids carry 'northwind'.
    assert.deepEqual(created, [['p1', { kind: 'company', uids: ['q-nebula', 'q-aster'], title: 'Two clouds' }]]);
    await press(m, 'button-delete-comparison-k1');
    // Mutation checked: delete on the first press → removed is non-empty here.
    assert.deepEqual(removed, []);
    assert.match(textOf(byTid(m, 'confirm-delete-comparison-k1')), /stay in this project/);
    await press(m, 'button-delete-comparison-confirm-k1');
    assert.deepEqual(removed, [['p1', 'k1']]);
    await press(m, 'button-remove-column-k1-q-fjord');
    assert.deepEqual(columns, [['p1', 'k1', 'q-fjord']]);
  } finally { await m.unmount(); restore(); }
});

test('an archived project shows its comparisons and offers no change', async () => {
  const { m, restore } = await mount('/research/projects/p1/comparisons', {}, { read: async () => ({ ...READ, item: { ...PROJECT, status: 'archived', archived_at: '2026-11-12 11:00:00' } }) });
  try {
    await settle(m);
    assert.ok(byTid(m, 'comparison-table-k1'));
    // Mutation checked: ignore `archived` on the card → Delete and Add company are drawn here.
    for (const id of ['button-delete-comparison-k1', 'button-add-column-k1', 'button-remove-column-k1-q-nebula', 'pick-company-q-nebula', 'form-new-comparison', 'button-remove-company-q-aster']) {
      assert.equal(Boolean(byTid(m, id)), false, id);
    }
  } finally { await m.unmount(); restore(); }
});

function mountPanel(props, list) {
  const real = { ...researchProjectsApi };
  const realCompared = { ...researchProjectComparisonsApi };
  const calls = [];
  Object.assign(researchProjectsApi, { list: list || (async () => ({ items: [{ uid: 'p1', title: 'EU GPU', status: 'in_progress' }, { uid: 'p2', title: 'Seed funds', status: 'in_progress' }] })) });
  researchProjectsApi.link = async (...args) => { calls.push(['link', ...args]); return { ok: true, added: true }; };
  Object.assign(researchProjectComparisonsApi, {
    addSubjects: async (...args) => { calls.push(['add', ...args]); return { ok: true, added: args[2].length, already: 0 }; },
    create: async (...args) => { calls.push(['create', ...args]); return { item: { uid: 'k9', title: 'Nebula Compute · Aster Cloud' } }; },
  });
  return mountContracts(h(AddToResearch, { onClose() {}, ...props }), '/research/companies', { id: 1, role: 'founder' }).then((m) => ({
    m, calls, restore() { Object.assign(researchProjectsApi, real); Object.assign(researchProjectComparisonsApi, realCompared); },
  }));
}
const TWO = [{ uid: 'q-nebula', name: 'Nebula Compute' }, { uid: 'q-aster', name: 'Aster Cloud' }];

test('Add to research: nothing is sent until a project is picked and confirmed; the outcome links into the project', async () => {
  const { m, calls, restore } = await mountPanel({ kind: 'company', items: TWO, mode: 'add' });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'add-to-research-items')), /Nebula Compute, Aster Cloud/);
    assert.equal(m.props(byTid(m, 'button-add-to-research-confirm')).disabled, true, 'no project picked');
    await submit(m, 'form-add-to-research');
    assert.deepEqual(calls, []);
    await act(async () => { m.props(byTid(m, 'research-target-p1')).onChange(); });
    await settle(m);
    await submit(m, 'form-add-to-research');
    assert.deepEqual(calls, [['add', 'p1', 'company', ['q-nebula', 'q-aster']]]);
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Added 2 entries to “EU GPU”/);
    assert.equal(m.props(byTid(m, 'add-to-research-open')).href, '/research/projects/p1/comparisons');
  } finally { await m.unmount(); restore(); }
});

test('Save to project links the Ask answer only after confirmation', async () => {
  const { m, calls, restore } = await mountPanel({ kind: 'answer', items: [{ uid: 'ask-answer', name: 'Which providers are independent?' }] });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'add-to-research-items')), /Which providers are independent/);
    await act(async () => { m.props(byTid(m, 'research-target-p1')).onChange(); });
    assert.deepEqual(calls, []);
    await submit(m, 'form-add-to-research');
    assert.deepEqual(calls, [['link', 'p1', 'answers', 'ask-answer']]);
    assert.match(textOf(byTid(m, 'add-to-research-result')), /Answer saved to “EU GPU”/);
    assert.equal(m.props(byTid(m, 'add-to-research-open')).href, '/research/projects/p1');
  } finally { await m.unmount(); restore(); }
});

test('Compare: one comparison of the selection, with its title; more than six is refused before anything is sent', async () => {
  let r = await mountPanel({ kind: 'company', items: TWO, mode: 'compare' });
  try {
    await settle(r.m);
    await act(async () => { r.m.props(byTid(r.m, 'research-target-p2')).onChange(); });
    await change(r.m, 'input-comparison-title', 'Two clouds');
    await submit(r.m, 'form-add-to-research');
    assert.deepEqual(r.calls, [['create', 'p2', { kind: 'company', uids: ['q-nebula', 'q-aster'], title: 'Two clouds' }]]);
    assert.match(textOf(byTid(r.m, 'add-to-research-result')), /Comparison “Nebula Compute · Aster Cloud” is in “Seed funds”.*Open the comparison/);
  } finally { await r.m.unmount(); r.restore(); }
  const seven = Array.from({ length: 7 }, (_, i) => ({ uid: `c${i}`, name: `Company ${i}` }));
  r = await mountPanel({ kind: 'company', items: seven, mode: 'compare' });
  try {
    await settle(r.m);
    assert.match(textOf(byTid(r.m, 'add-to-research-too-many')), /at most 6/);
    await act(async () => { r.m.props(byTid(r.m, 'research-target-p1')).onChange(); });
    await submit(r.m, 'form-add-to-research');
    // Mutation checked: drop the limit check in the panel → create is called with seven uids.
    assert.deepEqual(r.calls, []);
  } finally { await r.m.unmount(); r.restore(); }
});

test('Add to research: an unreadable project list says Unavailable with Retry and offers nothing to add to', async () => {
  let fail = true;
  const { m, calls, restore } = await mountPanel({ kind: 'fund', items: [{ uid: 'northwind', name: 'Northwind Seed' }], mode: 'add' }, async () => {
    if (fail) throw new Error('down');
    return { items: [] };
  });
  try {
    await settle(m);
    assert.match(textOf(byTid(m, 'add-to-research-unreadable')), /Unavailable/);
    // Mutation checked: read a failed list as no projects → add-to-research-none appears here.
    assert.equal(Boolean(byTid(m, 'add-to-research-none')), false);
    assert.equal(m.props(byTid(m, 'button-add-to-research-confirm')).disabled, true);
    assert.equal(m.props(byTid(m, 'button-add-to-new-research')).disabled, true);
    fail = false;
    await press(m, 'button-add-to-research-retry');
    assert.match(textOf(byTid(m, 'add-to-research-none')), /no active research project/);
    assert.deepEqual(calls, []);
  } finally { await m.unmount(); restore(); }
});

test('the directories: Add to research and a checkbox only where the page is given them', () => {
  const items = [{ uid: 'q-nebula', name: 'Nebula Compute', country: 'Norway', founded_year: 2021, sector: 'GPU cloud' }];
  const wrap = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
  const plain = wrap(h(DirectoryTable, { items, coverage: null }));
  assert.equal(plain.includes('Add to research'), false);
  assert.equal(plain.includes('pick-company-q-nebula'), false);
  const picked = wrap(h(DirectoryTable, { items, coverage: null, pick: { selected: new Map([['q-nebula', 'Nebula Compute']]), toggle() {}, onAdd() {} } }));
  assert.match(picked, /data-testid="pick-company-q-nebula"[^>]*checked|checked=""[^>]*data-testid="pick-company-q-nebula"/);
  assert.match(picked, /data-testid="button-add-to-research-q-nebula"/);
  const fund = { uid: 'northwind', name: 'Northwind Seed', source_name: 'List', source_url: 'https://x.example', hq: 'Copenhagen' };
  const result = { loading: false, error: null, data: { items: [fund], total: 1, offset: 0, limit: 25, coverage: null, sources: [] } };
  const base = { query: { q: '', limit: 25, offset: 0 }, onQuery() {}, search: '', onSearch() {}, result, facets: null, selected: null, onSelect() {}, onClose() {} };
  assert.equal(wrap(h(FundDirectoryView, base)).includes('Add to my research'), false);
  assert.match(wrap(h(FundDirectoryView, { ...base, onResearch() {} })), /data-testid="button-fund-research-northwind"[^>]*>Add to my research/);
});
