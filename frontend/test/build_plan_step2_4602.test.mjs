/**
 * D4602 step 2 (#4602, Build v2 boards BD2, BD4, BD5, BD14m, BD16):
 *
 *   · the phone Build overview opens the Plan in one tap (Overview · Plan ·
 *     Progress, links with aria-current, and a Build Plan row), with the venture;
 *   · phone Progress is searched, filtered (Filters (N), a sheet of native
 *     radio chips, Show N items) and sorted over the desk's own model;
 *   · a proposal's evidence chips open BD4's sheet, where each reference opens
 *     its own record where a record page reads it, and the sheet is the
 *     address's `?evidence=<uid>`, so Back from a record reopens it;
 *   · the radio chips carry a check mark, not colour alone, and 44px on a phone.
 *
 * Mounted against the Worker's plan shapes through a stubbed fetch. Every
 * venture, item and label is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_step2_4602.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuildPlan from '../src/pages/cycles/BuildPlan.jsx';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import BuildPhoneNav from '../src/pages/cycles/BuildPhoneNav.jsx';
import { ChoiceField } from '../src/pages/cycles/BuildPlanCards.jsx';
import { evidenceCountLine, evidenceHref, evidenceNodes, evidenceParam } from '../src/pages/cycles/buildPlanModel.js';
import { filterCount, filterRows, progressRows } from '../src/pages/cycles/buildProgressModel.js';

const h = React.createElement;
/** The opening tag of the element with this test id, attributes in any order. */
const tagOf = (out, id) => (out.match(new RegExp(`<[a-z]+ [^>]*data-testid="${id}"[^>]*>`)) || [''])[0];
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const WIZARD = '55555555-5555-4555-8555-555555555555';
const EVIDENCE = [
  { kind: 'pain_group', ref: '12', label: 'Setup takes two days', source_label: 'Recorded' },
  { kind: 'hypothesis', ref: '4', label: 'Setup is the bottleneck', source_label: 'Typed' },
  { kind: 'experiment', ref: '8', label: 'Concierge setup', source_label: 'Typed' },
  { kind: 'signal', ref: '31', label: 'loi', source_label: 'Document' },
];
const accepted = (uid, kind, title, table, id) => ({
  uid, kind, status: 'accepted', payload: { title }, evidence: [], decided_at: '2026-10-12 15:00:00', landed_table: table, landed_id: id,
});
const PLAN = () => ({
  plan: { uid: 'plan-uid', scope: 'venture', status: 'open', prepared_at: '2026-10-12 14:05:00' },
  verdict: { id: 9, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6 },
  brief: null,
  modules: {
    'solution-design': [
      { uid: WIZARD, kind: 'feature', status: 'proposed', payload: { title: 'One-day setup wizard', description: 'Set up in a day.' }, evidence: EVIDENCE },
      accepted('a1', 'feature', 'Live ETA panel', 'mvp_features', '6'),
    ],
    'prototype-mvp': [accepted('a2', 'must-have', 'Bulk import', 'mvp_features', '5'), accepted('a3', 'must-have', 'Setup in a day', 'mvp_features', '7')],
    'product-roadmap': [accepted('a4', 'roadmap', 'Carrier integrations', 'roadmap_okrs', '9')],
    'company-creation': [accepted('a5', 'formation-step', 'Incorporate', 'formation_steps', '3')],
    'operating-systems': [],
    'founding-team': [],
  },
});

function handler() {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (/\/cycles\/build\/plan\/handoffs\?/.test(url) && method === 'GET') return response({ handoffs: [] });
    if (/\/cycles\/build\/plan\/links\?/.test(url)) return response({ links: [] });
    if (/\/cycles\/build\/plan\/states\?/.test(url)) return response({ states: [] });
    if (/\/cycles\/build\/plan\/word\?/.test(url) && method === 'GET') return response({ wording: null });
    if (/\/cycles\/build\/plan\/since\?/.test(url)) return response({ plan: 'plan-uid', status: 'open', changed: false, new: 0, contradicting: 0 });
    if (/\/cycles\/build\/plan\?/.test(url) && method === 'GET') return response(PLAN());
    if (/\/connectors$/.test(url)) return response({ ok: true, items: [] });
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    if (url.includes('/cycles/validate/overview')) return response({ cards: [] });
    return response({});
  };
}

let where = '';
function Where() { const l = useLocation(); where = `${l.pathname}${l.search}`; return null; }

async function mounted({ tab = 'plan', phone = false, at = '/build/plan?project_id=3', role = 'founder' } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const handle = handler();
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [at] }, h(Where), h(BuildPlan, { tab, projectId: 3, search: '?project_id=3', cards: [], role, phone }))));
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)), count: (id) => all(id).length,
    texts: (id) => all(id).map(text),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); },
    pick: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value: props(n).value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ───────────────────────────────── BD4: evidence opens its own record

test('a reference opens the record page that reads its row, and only where one does', () => {
  // Mutation checked: `signal-` left off → Demand signals' reader is asked for
  // an id it does not answer; `landedId` dropped → `../x` reaches a URL; an
  // experiment mapped to Experiments → another table's row with that number.
  const q = '?project_id=3&scope=h-4';
  assert.equal(evidenceHref({ kind: 'pain_group', ref: '12' }, q), '/validate/problem-discovery/12?project_id=3');
  assert.equal(evidenceHref({ kind: 'hypothesis', ref: '4' }, q), '/validate/experiments/4?project_id=3');
  assert.equal(evidenceHref({ kind: 'signal', ref: '31' }, q), '/validate/demand-signals/signal-31?project_id=3');
  assert.equal(evidenceHref({ kind: 'decision', ref: '9' }, q), '/validate/verdict/9?project_id=3');
  assert.equal(evidenceHref({ kind: 'feature', ref: '6' }, q), '/build/solution-design/6?project_id=3');
  for (const kind of ['experiment', 'finding', 'commitment', 'nonsense']) assert.equal(evidenceHref({ kind, ref: '8' }, q), null, kind);
  for (const ref of ['0', '-1', '../x', '4a', '', null, '1234567890123456789']) assert.equal(evidenceHref({ kind: 'hypothesis', ref }, q), null, String(ref));

  const nodes = evidenceNodes({ evidence: EVIDENCE }, '?project_id=3');
  assert.deepEqual(nodes.map((x) => [x.kind, x.label, x.source, Boolean(x.href)]), [
    ['Problem discovery', 'Setup takes two days', 'Recorded', true],
    ['Hypothesis', 'Setup is the bottleneck', 'Typed', true],
    ['Experiment', 'Concierge setup', 'Typed', false],
    ['Demand', 'LOI', 'Document', true],
  ]);
  assert.equal(evidenceCountLine(nodes), '4 references · 3 open their record');
  assert.equal(evidenceCountLine(nodes.slice(0, 1)), '1 reference · each opens its record');
  assert.equal(evidenceCountLine(nodes.slice(2, 3)), '1 reference · none has a record page; each shows its kind');
  assert.equal(evidenceCountLine([]), 'No evidence is recorded on this item.');
  assert.equal(evidenceParam('?project_id=3&evidence=abc-1'), 'abc-1');
  assert.equal(evidenceParam('?evidence=%3Cscript%3E'), null);
  assert.equal(evidenceParam('?project_id=3'), null);
});

test('a chip opens the evidence sheet; the address names it, so Back from a record reopens it', async () => {
  const m = await mounted();
  try {
    assert.equal(m.props(`plan-item-because-${WIZARD}-chip-0`)['aria-haspopup'], 'dialog', 'each chip is a button that opens a dialog');
    await m.click(`plan-item-because-${WIZARD}-chip-0`);
    assert.ok(m.has('plan-evidence-sheet'));
    assert.equal(where, `/build/plan?project_id=3&evidence=${WIZARD}`, 'the open sheet is in the address');
    assert.equal(m.textOf('plan-evidence-title'), 'Evidence for “One-day setup wizard”');
    assert.equal(m.textOf('plan-evidence-count'), '4 references · 3 open their record');
    assert.equal(m.props('plan-evidence-open-0').href, '/validate/problem-discovery/12?project_id=3');
    assert.equal(m.props('plan-evidence-open-3').href, '/validate/demand-signals/signal-31?project_id=3');
    assert.ok(!m.has('plan-evidence-open-2') && m.has('plan-evidence-kind-only-2'), 'an experiment shows its kind only');
    assert.equal(m.count('plan-evidence-node-0') + m.count('plan-evidence-node-1') + m.count('plan-evidence-node-2') + m.count('plan-evidence-node-3'), 4, 'signals one by one');
  } finally { await m.close(); }

  // Back from the record lands on the address the sheet wrote: the same proposal's sheet opens.
  const back = await mounted({ at: `/build/plan?project_id=3&evidence=${WIZARD}` });
  try {
    assert.ok(back.has('plan-evidence-sheet'));
    assert.equal(back.textOf('plan-evidence-title'), 'Evidence for “One-day setup wizard”');
  } finally { await back.close(); }

  // An address naming an item that is not on the plan opens nothing.
  const stale = await mounted({ at: '/build/plan?project_id=3&evidence=gone' });
  try { assert.ok(!stale.has('plan-evidence-sheet')); } finally { await stale.close(); }
});

// ───────────────────────────────── BD2, BD14m B: Plan one tap from the phone overview

test('the phone Build overview carries Overview · Plan · Progress and a Build Plan row, with the venture, in every state', () => {
  const draw = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'build', search: '?project_id=3', ...props })));
  for (const props of [{ status: 'loading' }, { status: 'unreadable' }, { status: 'refused', message: 'No.' }, { raw: { focus: null, index: [] }, status: 'ready' }]) {
    const out = draw(props);
    assert.match(out, /<nav aria-label="Build"/, props.status);
    assert.match(tagOf(out, 'build-phone-tab-plan'), /href="\/build\/plan\?project_id=3"/, `${props.status}: Plan, with the venture`);
    assert.match(tagOf(out, 'build-phone-tab-plan'), /min-h-\[44px\]/, '44px targets');
    assert.match(tagOf(out, 'build-phone-tab-progress'), /href="\/build\/plan\/progress\?project_id=3"/);
    assert.match(tagOf(out, 'build-phone-tab-overview'), /aria-current="page"/);
    assert.doesNotMatch(tagOf(out, 'build-phone-tab-plan'), /aria-current/);
  }
  const ready = draw({ raw: { focus: null, index: [] }, status: 'ready' });
  assert.match(tagOf(ready, 'phone-index-build-plan'), /href="\/build\/plan\?project_id=3"/);
  assert.doesNotMatch(ready, /Build Plan[\s\S]{0,400}Not recorded/, 'the plan row is a door, not a missing value');
  const validate = renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', search: '?project_id=3', status: 'loading' })));
  assert.doesNotMatch(validate, /build-phone-tab/, 'only Build draws them');
  // A one-claim plan keeps its scope on Plan and Progress, never on Overview.
  const scoped = renderToStaticMarkup(h(MemoryRouter, null, h(BuildPhoneNav, { active: 'plan', search: '?project_id=3&scope=h-4' })));
  assert.match(scoped, /href="\/build\?project_id=3"/);
  assert.match(scoped, /href="\/build\/plan\/progress\?project_id=3&amp;scope=h-4"/);
});

test('the plan’s phone pages carry Build’s tabs; an Operating Partner keeps Progress only', async () => {
  const phone = await mounted({ phone: true });
  try {
    assert.ok(phone.has('build-phone-tabs') && !phone.has('plan-tabs'));
    assert.equal(phone.props('build-phone-tab-plan')['aria-current'], 'page');
  } finally { await phone.close(); }
  const desk = await mounted();
  try { assert.ok(desk.has('plan-tabs') && !desk.has('build-phone-tabs')); } finally { await desk.close(); }
  const partner = await mounted({ tab: 'progress', phone: true, role: 'partner', at: '/build/plan/progress?project_id=3' });
  try {
    assert.ok(partner.has('plan-tabs') && !partner.has('build-phone-tabs'));
    assert.deepEqual(partner.texts('plan-tab-progress'), ['Progress']);
  } finally { await partner.close(); }
});

// ───────────────────────────────── BD14m A, BD5: compact phone Progress

test('phone Progress: Search, Filters (N) in a sheet of native radios, Show N items, and Sort', async () => {
  // Mutation checked: Show applying nothing → the card count stays 5; the
  // count read off the applied filters instead of the draft → "Show 5 items".
  const m = await mounted({ tab: 'progress', phone: true, at: '/build/plan/progress?project_id=3' });
  try {
    assert.ok(m.has('plan-progress-controls-phone') && !m.has('plan-progress-filter-module'), 'no desk selects on a phone');
    assert.equal(m.textOf('plan-progress-filters-open'), 'Filters');
    await m.click('plan-progress-filters-open');
    assert.ok(m.has('plan-progress-filters'));
    assert.equal(m.textOf('plan-progress-filters-show'), 'Show 5 items');
    await m.pick('plan-progress-f-module-prototype-mvp');
    assert.equal(m.textOf('plan-progress-filters-show'), 'Show 2 items', 'the count is the draft’s, before it is applied');
    assert.equal(m.count('plan-progress-card'), 5, 'nothing applies until Show');
    await m.click('plan-progress-filters-show');
    assert.ok(!m.has('plan-progress-filters'));
    assert.equal(m.count('plan-progress-card'), 2);
    assert.equal(m.textOf('plan-progress-filters-open'), 'Filters (1)');
    await m.change('plan-progress-search', 'bulk');
    assert.equal(m.count('plan-progress-card'), 1, 'search and filters are an AND, as on the desk');
    await m.change('plan-progress-search', '');
    // Sort applies as it is picked.
    await m.click('plan-progress-sort-open');
    await m.pick('plan-progress-s-sort-name');
    await m.click('plan-progress-sort-done');
    assert.equal(m.props('plan-progress-sort-open')['aria-label'], 'Sort: Name, A to Z');
    assert.match(m.texts('plan-progress-card')[0], /Bulk import/);
    // Clear in the sheet empties the draft; Show applies it.
    await m.click('plan-progress-filters-open');
    await m.click('plan-progress-filters-clear');
    await m.click('plan-progress-filters-show');
    assert.equal(m.textOf('plan-progress-filters-open'), 'Filters');
    assert.equal(m.count('plan-progress-card'), 5);
  } finally { await m.close(); }
});

test('the phone’s choices select what the desk’s select: one filterRows, one count', () => {
  const plan = PLAN();
  const rows = progressRows(plan, [], []);
  const f = { q: '', module: 'prototype-mvp', stage: '', tool: '' };
  assert.equal(filterCount(f), 1);
  assert.equal(filterCount({ q: 'x', module: '', stage: 'accepted', tool: 'github' }), 2, 'search is not a filter');
  assert.deepEqual(filterRows(rows, f, 'name').map((r) => r.title), ['Bulk import', 'Setup in a day']);
});

// ───────────────────────────────── BD16: native radio chips

test('radio chips are native radios in a named group, with a check mark beside the weight and 44px on a phone', () => {
  const field = { key: 'stage', label: 'Stage', options: ['', 'accepted', 'built'], words: { '': 'Any', accepted: 'Accepted', built: 'Built' } };
  const out = renderToStaticMarkup(h(ChoiceField, { field, value: 'accepted', name: 'g', testPrefix: 'x', phone: true, onPick() {} }));
  assert.match(out, /^<fieldset[^>]*><legend[^>]*>Stage<\/legend>/);
  assert.equal((out.match(/<input type="radio"[^>]* name="g"/g) || []).length, 3, 'one name: one tab stop, arrows move and select');
  assert.equal((out.match(/checked=""/g) || []).length, 1);
  assert.match(out, /<label for="g-accepted" class="[^"]*min-h-\[44px\][^"]*"><span aria-hidden="true" class="mr-1">✓<\/span>Accepted<\/label>/);
  assert.match(out, /<label for="g-any"[^>]*>Any<\/label>/, 'an unselected chip has no mark');
  assert.match(tagOf(out, 'x-stage-any'), /id="g-any"/);
  const desk = renderToStaticMarkup(h(ChoiceField, { field, value: '', name: 'g', onPick() {} }));
  assert.match(desk, /min-h-\[34px\]/);
  assert.match(desk, /data-testid="plan-edit-stage-built"/, 'the edit dialog keeps its own test ids');
});
