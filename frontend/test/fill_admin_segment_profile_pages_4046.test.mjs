// #4046 Group B4 — Ask on HQ's New segment, the pages half.
//   - the model: `SCOPED_FORMS.segment` is FILL_FIELDS' two fields on
//     segment_profiles (name, who); the key, profile and status are said never
//     to be filled;
//   - NewSegment, mounted against a stubbed fetch: the read names no record and
//     no parent (the Worker names the caller); Name and Who they are draw a
//     trigger, each label naming its box; Ask sends only those two values,
//     never the key; Accept places the words; Confirm creation posts them, then
//     records the placed proposals against the id the 201 names, before the
//     result replaces the form;
//   - with nothing placed, Create records nothing; a plain Admin reads no sheet
//     (the page refuses before any form).
//
// Booleans, not nodes: a failing assert on a DOM node prints the whole fake tree and never ends.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_admin_segment_profile_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import NewSegment from '../src/pages/admin/segments/NewSegment.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const SEG = SCOPED_FORMS.segment;
const HQ = { id: 903, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };
const PLAIN = { ...HQ, id: 904, is_super_admin: 0 };

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const field = (name, label) => ({ field: name, label, table: 'segment_profiles', column: name, class: 'composition', sources: ['eadwyn'],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [] });
const SHEET = {
  page: SEG.page, form: SEG.form, project: null, scope: 'owner:903', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }],
  fields: [field('name', 'Name'), field('who', 'Who they are')],
  quote: { option: `form:${SEG.form}`, state: 'ok', runs: 0, average_microusd: null },
};

/** `routes`: `METHOD /path` → handler(call, state). */
async function mounted(routes, user = HQ) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const state = {};
  globalThis.fetch = async (u, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = String(u).split('?');
    const call = { url: String(u), path, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (path === '/api/auth/me') return response(user);
    const key = Object.keys(routes).find((k) => k === `${method} ${path}`);
    if (key) return routes[key](call, state);
    if (method === 'GET') return response({});
    throw new Error(`unrouted ${method} ${path}`);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/persona-segments/new'] }, h(AuthProvider, null, h(NewSegment)))));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  const byText = (tag, words) => walk(document.body).find((n) => n.tagName?.toLowerCase?.() === tag && text(n).trim() === words);
  state.has = (id) => !!byId(id);
  return {
    calls, flush, state,
    has: (id) => !!byId(id),
    value: (id) => props(byId(id)).value,
    textOf: (id) => text(byId(id)),
    labelFor: (forId) => walk(container).some((n) => n.tagName?.toLowerCase?.() === 'label' && props(n).htmlFor === forId),
    idOf: (id) => props(byId(id)).id,
    async press(id) { const p = props(byId(id)); assert.equal(typeof p.onClick, 'function', `no ${id} to press`); assert.equal(!!p.disabled, false, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async changeLabelled(words, value) {
      const label = walk(container).find((n) => n.tagName?.toLowerCase?.() === 'label' && text(n).trim().startsWith(words));
      const box = label?.childNodes.find((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
      assert.equal(!!box, true, `no box labelled ${words}`);
      await act(async () => { props(box).onChange({ target: { value } }); }); await flush();
    },
    async submit() { const form = walk(container).find((n) => n.tagName?.toLowerCase?.() === 'form'); assert.equal(!!form, true, 'no form'); await act(async () => { props(form).onSubmit(event); }); await flush(); },
    async confirm() { const b = byText('button', 'Confirm creation'); assert.equal(!!b, true, 'no Confirm creation'); await act(async () => { await props(b).onClick(event); }); await flush(); },
    sheets: () => calls.filter((c) => c.path === '/api/fills/sheet'),
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      localStorage.removeItem?.('user');
      restore();
    },
  };
}

test('the model: the name and who they are on segment_profiles; the key, profile and status are never filled', () => {
  assert.deepEqual(SEG, { page: 'Super Admin · Content · Personas', form: 'segment-profile', table: 'segment_profiles' });
  assert.deepEqual(fieldsOf(SEG.page, SEG.form).map((f) => [f.field, f.label, f.table, f.class]),
    [['name', 'Name', 'segment_profiles', 'composition'], ['who', 'Who they are', 'segment_profiles', 'composition']]);
  assert.equal(NOT_FILLED_HERE['segment-profile'][0], 'Key, profile and status · they are HQ’s call.');
});

test('New segment: the read names no record and no parent; Name and Who draw Ask, each label naming its box; typing clears a trigger', async () => {
  // Mutation checked: the FillLabel wrapper dropped from Who they are → no who trigger; htmlFor dropped → labelFor is false.
  const w = await mounted({ 'GET /api/fills/sheet': () => response(SHEET) });
  try {
    const sheets = w.sheets();
    assert.equal(sheets.length, 1);
    assert.match(sheets[0].url, /form=segment-profile/);
    assert.doesNotMatch(sheets[0].url, /record=|parent=|project=/, 'a new segment hangs under the caller, named by the Worker');
    assert.equal(w.has('fill-trigger-name'), true);
    assert.equal(w.has('fill-trigger-who'), true);
    assert.equal(w.has('fill-form-trigger'), true, 'the form\'s Ask');
    assert.match(w.textOf('fill-scoped-not-here'), /Key, profile and status/);
    for (const id of ['new-segment-name', 'new-segment-who']) {
      assert.equal(w.idOf(id), id);
      assert.equal(w.labelFor(id), true, `${id}: the label names its box`);
    }
    await w.change('new-segment-name', 'Typed by me');
    assert.equal(w.has('fill-trigger-name'), false, 'a typed name draws no trigger');
    assert.equal(w.has('fill-trigger-who'), true);
  } finally { await w.close(); }
});

test('Ask → Accept → Confirm creation: the run reads only the name and who; the segment is created with the words, then recorded on the id the 201 names', async () => {
  // Mutations checked: `fill.afterSave` dropped from save() → no record call; `key: draft.key` added to the hook's
  // values → the run carries the key. (afterSave moved after setCreated is caught by the wiring test.)
  const sse = `event: done\ndata: ${JSON.stringify({ proposals: [
    { uid: 'p-1', field: 'name', value: 'Climate hardware founders' },
    { uid: 'p-2', field: 'who', value: 'Founders building physical climate products.' },
  ], dropped: [], charged_microusd: 1200 })}\n\n`;
  let createdShownAtRecord = null;
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/ai/rail/run': () => ({ ok: true, status: 200, headers: new Map(), text: async () => sse, json: async () => ({}) }),
    'POST /api/personas/segments': (c) => response({ segment: { id: 41, ...c.body, version: 1 } }, 201),
    'POST /api/fills/record': (_c, s) => { createdShownAtRecord = s.has('segment-created'); return response({ record: 'segment_profiles:41', outcomes: [] }); },
  });
  try {
    await w.changeLabelled('Segment key', 'climate_secret_key');
    await w.press('fill-form-trigger');
    await w.press('fill-sheet-preview');
    const run = w.calls.find((c) => c.path === '/api/ai/rail/run');
    assert.equal(!!run, true, 'the run was asked');
    assert.deepEqual([run.body.option, run.body.page, run.body.record ?? null, run.body.parent ?? null, run.body.project ?? null],
      [`form:${SEG.form}`, SEG.page, null, null, null], 'the run names no venture, record or parent');
    assert.doesNotMatch(JSON.stringify(run.body), /climate_secret_key/, 'the key never reaches the run');
    await w.press('fill-sheet-accept-all');
    assert.equal(w.value('new-segment-name'), 'Climate hardware founders');
    assert.equal(w.value('new-segment-who'), 'Founders building physical climate products.');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false, 'nothing is recorded before Create');
    await w.submit();
    await w.confirm();
    const sent = w.calls.find((c) => c.method === 'POST' && c.path === '/api/personas/segments');
    assert.deepEqual([sent.body.key, sent.body.name, sent.body.who], ['climate_secret_key', 'Climate hardware founders', 'Founders building physical climate products.']);
    const rec = w.calls.find((c) => c.path === '/api/fills/record');
    assert.equal(!!rec, true, 'Create records the placed proposals');
    assert.deepEqual(rec.body, { page: SEG.page, form: SEG.form, record: 41, proposals: ['p-1', 'p-2'] });
    assert.equal(createdShownAtRecord, false, 'recorded before the result replaces the form');
    assert.equal(w.has('segment-created'), true);
    const reads = w.sheets().length;
    await w.flush();
    assert.equal(w.sheets().length, reads, 'the hook is off once created: no read of a new segment');
  } finally { await w.close(); }
});

test('Create with nothing placed records nothing', async () => {
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/personas/segments': (c) => response({ segment: { id: 42, ...c.body } }, 201),
  });
  try {
    await w.changeLabelled('Segment key', 'own_words');
    await w.change('new-segment-name', 'My own name');
    await w.submit();
    await w.confirm();
    assert.equal(w.calls.find((c) => c.path === '/api/personas/segments' && c.method === 'POST').body.name, 'My own name');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false);
    assert.equal(w.has('segment-created'), true);
  } finally { await w.close(); }
});

test('a plain Admin is refused before any form, and reads no sheet', async () => {
  // Mutation checked: `enabled: hq && !created` → `enabled: !created` → the plain Admin's page reads the sheet.
  const w = await mounted({ 'GET /api/fills/sheet': () => response(SHEET) }, PLAIN);
  try {
    assert.equal(w.has('new-segment-refused'), true);
    assert.equal(w.sheets().length, 0);
  } finally { await w.close(); }
});

test('the wiring: the hook sits above the HQ-only return; the record step sits between the 201 and the result', () => {
  const page = read('pages/admin/segments/NewSegment.jsx');
  assert.match(page, /scope: SCOPED_FORMS\.segment, enabled: hq && !created,\n\s+values: \{ name: draft\.name, who: draft\.who \},/);
  assert.ok(page.indexOf('useScopedFill({') < page.indexOf('if (!hq) return'), 'the hook runs on every render, before the early return');
  assert.match(page, /await fill\.afterSave\(result\.segment\.id\);\n\s+setCreated\(result\.segment\);/);
  assert.match(page, /<FillLabel fill=\{fill\} name="name" label="Name" value=\{draft\.name\}>/);
  assert.match(page, /<FillLabel fill=\{fill\} name="who" label="Who they are" value=\{draft\.who\}>/);
  assert.doesNotMatch(page, /name="(key|profile|status)"/, 'nothing else draws Ask');
});
