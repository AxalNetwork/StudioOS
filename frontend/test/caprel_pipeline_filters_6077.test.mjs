/**
 * D6077 (#6077) — Capital relationships' Pipeline: the bar drawn as `pipeBar` on CRL2 and CRL3. Search investors;
 * Stage, Fit, Warm path, Source and Next step; Sort, Next step due first. Each narrows the Board and the List alike;
 * no match says so and offers Clear; the filters live in the address (refresh, Back) and clear on a venture switch;
 * bulk Move acts only on picked rows still shown; Fit and Source are off, and say so, when the read did not carry them.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_pipeline_filters_6077.test.mjs
 */
import './_cycleSteps.mjs';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CapRelPipeline from '../src/pages/raise/caprel/CapRelPipeline.jsx';
import { PIPELINE_FILTERS, readFilters, writeFilters } from '../src/pages/raise/caprel/capRelUrlFilters.js';
import { CLEAR_PATCH, activeFilters, matchesPipeline, pipelineView, sortPipeline, sortedColumns, weekAfter } from '../src/pages/raise/caprel/capRelPipelineFilters.js';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const tick = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });

// The page reads today from the clock: it is fixed here, so Overdue and the next 7 days never depend on the run's date.
const TODAY = '2026-11-14';
mock.timers.enable({ apis: ['Date'], now: Date.parse(`${TODAY}T12:00:00Z`) });
const shift = (n) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// One investor per filter value, so each filter picks a different set.
const PROSPECTS = [
  { id: 41, name: 'Bluefern Capital', stage: 'meeting', fit: 'fits', via_call: true, warm_path: 'via Lin Park', next_step: 'Send the deck', next_step_due: shift(-2), last_contact: '2026-10-01 09:00:00', updated_at: '2026-10-05' },
  { id: 42, name: 'Northwind Ventures', stage: 'to_contact', fit: 'outside', via_call: false, warm_path: null, next_step: 'Intro call', next_step_due: shift(3), last_contact: '2026-10-09 09:00:00', updated_at: '2026-10-02' },
  { id: 43, name: 'Alder Seed', stage: 'contacted', fit: 'unclear', via_call: false, warm_path: '  ', next_step: null, next_step_due: null, last_contact: null, updated_at: '2026-10-08' },
  { id: 44, name: 'Kite Angels', stage: 'meeting', fit: 'not_recorded', via_call: false, warm_path: 'Board member', next_step: 'Data room', next_step_due: shift(30), last_contact: '2026-10-04 09:00:00', updated_at: '2026-10-07' },
];

const where = { location: null, navigate: null };
function Probe() { where.location = useLocation(); where.navigate = useNavigate(); return null; }

async function mount(url, { signals = 'ok', roundCalls = true, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const writes = [];
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u);
    if (o.method && o.method !== 'GET') { writes.push({ url: s, body: o.body ? JSON.parse(o.body) : undefined }); return response({ ok: true }); }
    if (/raise-prospects/.test(s)) return response({ items: PROSPECTS, signals, round_calls: roundCalls });
    return response({});
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const tree = (pid) => h(MemoryRouter, { initialEntries: [url] }, h(Probe), h(CapRelPipeline, { projectId: pid, search: `?project_id=${pid}` }));
  await act(async () => root.render(tree(3)));
  await tick();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const ids = (prefix) => nodes().map((n) => props(n)['data-testid']).filter((t) => typeof t === 'string' && new RegExp(`^${prefix}\\d+$`).test(t)).map((t) => Number(t.slice(prefix.length)));
  return {
    writes, by, props: (id) => props(by(id)),
    has: (id) => Boolean(by(id)),
    text: (id) => text(by(id)).replace(/\s+/g, ' ').trim(),
    cards: () => ids('caprel-card-'),
    rows: () => ids('caprel-row-'),
    search: () => where.location.search,
    async change(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value, checked: value } }); }); await tick(); },
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await tick(); },
    async back() { await act(async () => { where.navigate(-1); }); await tick(); },
    async venture(pid) { await act(async () => root.render(tree(pid))); await tick(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const BASE = '/raise/capital-relationships/pipeline?project_id=3';
const READ = { signals: 'ok', roundCalls: true, today: '2026-11-14' };
const F = (o = {}) => ({ ...readFilters(PIPELINE_FILTERS, ''), ...o });

/* ------------------------------------------------------------------ the model */

test('the address holds each key, a value the bar does not offer reads as its default, and Next step due is the default sort', () => {
  assert.deepEqual(readFilters(PIPELINE_FILTERS, '?q=%20blue%20&stage=meeting&fit=fits&path=has&source=call&next=overdue&sort=name'),
    { passed: false, q: 'blue', stage: 'meeting', fit: 'fits', path: 'has', source: 'call', next: 'overdue', sort: 'name' });
  assert.deepEqual(readFilters(PIPELINE_FILTERS, '?stage=hot&fit=great&path=maybe&source=web&next=soon&sort=random'),
    { passed: false, q: '', stage: '', fit: '', path: '', source: '', next: '', sort: 'due' });
  assert.equal(writeFilters(PIPELINE_FILTERS, '?project_id=3&view=list', F({ sort: 'due', stage: 'passed' })).toString(), 'project_id=3&view=list&stage=passed');
});

test('each filter narrows to the investors it names', () => {
  const ids = (o, read = READ) => pipelineView(PROSPECTS, F(o), { ...read, today: TODAY }).map((p) => p.id).sort();
  assert.deepEqual(ids({ q: 'north' }), [42]);
  assert.deepEqual(ids({ q: 'lin park' }), [41], 'the search reads the warm path too');
  assert.deepEqual(ids({ stage: 'meeting' }), [41, 44]);
  assert.deepEqual(ids({ fit: 'outside' }), [42]);
  assert.deepEqual(ids({ fit: 'not_recorded' }), [44]);
  assert.deepEqual(ids({ path: 'has' }), [41, 44]);
  assert.deepEqual(ids({ path: 'none' }), [42, 43], 'a blank warm path is none');
  assert.deepEqual(ids({ source: 'call' }), [41]);
  assert.deepEqual(ids({ source: 'other' }), [42, 43, 44]);
  assert.deepEqual(ids({ next: 'overdue' }), [41]);
  assert.deepEqual(ids({ next: 'week' }), [42]);
  assert.deepEqual(ids({ next: 'set' }), [41, 42, 44]);
  assert.deepEqual(ids({ next: 'none' }), [43]);
  assert.deepEqual(ids({ stage: 'meeting', path: 'has', next: 'overdue' }), [41], 'filters combine');
  // Not read: Fit and Source are not applied, never read as "nobody matches".
  assert.deepEqual(ids({ fit: 'outside', source: 'call' }, { signals: 'unreadable', roundCalls: true }), [41, 42, 43, 44]);
  assert.deepEqual(ids({ source: 'call' }, { signals: 'ok', roundCalls: false }), [41, 42, 43, 44], 'no Source while round calls are off');
  assert.deepEqual(activeFilters(F({ fit: 'fits', q: 'x' }), { signals: 'not_read' }), ['q']);
  assert.equal(matchesPipeline({ id: 1, stage: 'meeting' }, F({ fit: 'not_recorded' }), READ), true, 'no fit on the row is Fit not recorded');
});

test('the sorts: Next step due first by default, an investor with none last; Last contact, Recently updated and Name', () => {
  assert.deepEqual(sortPipeline(PROSPECTS).map((p) => p.id), [41, 42, 44, 43]);
  assert.deepEqual(sortPipeline(PROSPECTS, 'last_contact').map((p) => p.id), [42, 44, 41, 43]);
  assert.deepEqual(sortPipeline(PROSPECTS, 'recent').map((p) => p.id), [43, 44, 41, 42]);
  assert.deepEqual(sortPipeline(PROSPECTS, 'name').map((p) => p.id), [43, 41, 44, 42]);
  assert.deepEqual(sortedColumns(PROSPECTS, 'due').columns.find((c) => c.stage === 'meeting').items.map((p) => p.id), [41, 44], 'each board column follows the sort');
  assert.deepEqual(sortedColumns(PROSPECTS, 'recent').columns.find((c) => c.stage === 'meeting').items.map((p) => p.id), [44, 41]);
  assert.equal(weekAfter('2026-12-28'), '2027-01-04');
  assert.deepEqual(Object.keys(CLEAR_PATCH), ['q', 'stage', 'fit', 'path', 'source', 'next'], 'Clear keeps the sort and the Passed column');
});

/* ------------------------------------------------------------------ mounted */

test('each filter narrows the Board and the List alike', async () => {
  for (const [qs, want] of [['stage=meeting', [41, 44]], ['fit=outside', [42]], ['path=none', [42, 43]], ['source=call', [41]], ['next=overdue', [41]], ['q=kite', [44]]]) {
    const board = await mount(`${BASE}&${qs}`);
    try { assert.deepEqual(board.cards().sort(), want, `board ${qs}`); } finally { await board.close(); }
    const list = await mount(`${BASE}&view=list&${qs}`);
    try { assert.deepEqual(list.rows().sort(), want, `list ${qs}`); } finally { await list.close(); }
  }
  const v = await mount(`${BASE}&view=list&sort=name`);
  try {
    assert.deepEqual(v.rows(), [43, 41, 44, 42], 'the list is in the chosen sort');
    assert.equal(v.props('caprel-pipe-sort').value, 'name');
  } finally { await v.close(); }
});

test('a filter with no match says so and offers Clear, which keeps the sort', async () => {
  const v = await mount(`${BASE}&q=nobody&stage=meeting&sort=name`);
  try {
    assert.ok(v.has('caprel-pipe-nomatch'));
    assert.ok(!v.has('caprel-board'), 'no empty board is drawn instead');
    assert.match(v.text('caprel-pipe-nomatch'), /No investor matches these filters/);
    assert.match(v.text('caprel-pipe-count'), /Showing 0 of 4 investors/);
    await v.click('caprel-pipe-nomatch-clear');
    assert.equal(v.search(), '?project_id=3&sort=name');
    assert.ok(!v.has('caprel-pipe-nomatch'));
    assert.deepEqual(v.cards().sort(), [41, 42, 43, 44]);
  } finally { await v.close(); }
});

test('the filters survive a refresh and Back, and clear on a venture switch', async () => {
  const v = await mount(BASE);
  let at;
  try {
    await v.change('caprel-pipe-stage', 'meeting');
    await v.change('caprel-pipe-fit', 'fits');
    assert.equal(v.search(), '?project_id=3&stage=meeting&fit=fits');
    assert.deepEqual(v.cards(), [41]);
    at = v.search();
    await v.back();
    assert.equal(v.search(), '?project_id=3&stage=meeting', 'Back restores the filter set before');
    assert.deepEqual(v.cards().sort(), [41, 44]);
    await v.venture(4);
    assert.equal(v.search(), '?project_id=3', 'another venture starts with none');
  } finally { await v.close(); }
  const again = await mount(`/raise/capital-relationships/pipeline${at}`);
  try {
    assert.deepEqual(again.cards(), [41], 'a refresh lands on the same investors');
    assert.equal(again.props('caprel-pipe-stage').value, 'meeting');
    assert.equal(again.props('caprel-pipe-fit').value, 'fits');
  } finally { await again.close(); }
});

test('bulk Move acts only on picked rows still shown', async () => {
  const v = await mount(`${BASE}&view=list`);
  try {
    await v.change('caprel-pick-41', true);
    await v.change('caprel-pick-42', true);
    assert.match(v.text('caprel-bulk'), /^2 picked/);
    await v.change('caprel-pipe-stage', 'meeting');
    assert.deepEqual(v.rows().sort(), [41, 44]);
    assert.match(v.text('caprel-bulk'), /^1 picked/, 'a hidden row is no longer picked');
    await v.click('caprel-bulk-move');
    await v.change('caprel-move-to', 'diligence');
    await v.click('caprel-move-go');
    assert.deepEqual(v.writes.map((w) => w.url.match(/prospects\/(\d+)/)[1]), ['41']);
  } finally { await v.close(); }
});

test('Fit and Source are off, and say why, when the read did not carry them; Source is not offered with round calls off', async () => {
  const v = await mount(`${BASE}&fit=outside`, { signals: 'unreadable' });
  try {
    assert.equal(v.props('caprel-pipe-fit').disabled, true);
    assert.deepEqual(v.cards().sort(), [41, 42, 43, 44], 'the Fit in the address is not applied');
    assert.match(v.text('caprel-pipe-count'), /unreadable right now/);
  } finally { await v.close(); }
  const off = await mount(BASE, { roundCalls: false });
  try {
    assert.ok(!off.has('caprel-pipe-source'));
    assert.ok(off.has('caprel-pipe-fit') && off.props('caprel-pipe-fit').disabled === false);
  } finally { await off.close(); }
});

test('every control of the bar is a native, labelled control with a 44px target below 1024px', async () => {
  const v = await mount(`${BASE}&stage=meeting`);
  try {
    for (const id of ['caprel-pipe-q', 'caprel-pipe-stage', 'caprel-pipe-fit', 'caprel-pipe-path', 'caprel-pipe-source', 'caprel-pipe-next', 'caprel-pipe-sort', 'caprel-pipe-clear', 'caprel-view-board', 'caprel-view-list']) {
      const n = v.by(id);
      assert.ok(n, `no ${id}`);
      assert.ok(['INPUT', 'SELECT', 'BUTTON'].includes(String(n.tagName || n.nodeName).toUpperCase()), `${id} is reached by the keyboard`);
      const p = v.props(id);
      assert.notEqual(p.tabIndex, -1, `${id} is in the tab order`);
      assert.match(p.className, /(^|\s)min-h-11(\s|$)/, `${id} is 44px tall below lg`);
      if (!/clear|view/.test(id)) assert.ok(p['aria-label'], `${id} is labelled`);
    }
  } finally { await v.close(); }
  // The phone board follows the Stage filter's column.
  const phone = await mount(`${BASE}&stage=meeting`, { phone: true });
  try { assert.equal(phone.props('caprel-board-stage').value, 'meeting'); } finally { await phone.close(); }
});

test('the Pipeline file draws the bar above both views and reads the filters from the address', () => {
  const src = readFileSync(new URL('../src/pages/raise/caprel/CapRelPipeline.jsx', import.meta.url), 'utf8');
  assert.match(src, /useTabFilters\(PIPELINE_FILTERS, projectId\)/);
  assert.match(src, /<List items=\{visible\}/, 'the List is given the shown rows only');
});
