// D1328 (#3489, part 5 of #2431): Fill with Eadwyn on the founder's forms.
//   - the model (`lib/fillForms.js`): which form has a sheet, the placed map,
//     what Save records, the waiting rows of this venture only, Accept all's
//     report in words;
//   - the form (AF3, AF7), mounted against a stubbed fetch: a trigger only
//     where the read gives one and only while the box is blank; Accept places
//     the value "Not saved" and writes nothing; the form's own Save writes,
//     then `POST /api/fills/record` with the saved row and the proposal; a
//     typed value drops its mark; an unreadable read says so with Try again;
//   - the module (AF1, AF16): "N waiting" from this venture's rows only, no
//     count when unreadable, Accept / Accept all through
//     `POST /api/fills/rows/accept` with each refusal in words, Discard all
//     behind its dialog, Edit handing the row on, Ask off while AI is off;
//   - the phone (AF23) and the wiring.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_founder_pages_d1328.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  FILL_PAGES, acceptReport, fillTarget, moduleFillTarget, placeValues, placedProposals, rowLines, savedId, stillPlaced, waitingRows,
} from '../src/lib/fillForms.js';
import { BUILD_FORMS, VALIDATE_FORMS } from '../src/pages/cycles/forms.js';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { FillModule } from '../src/pages/cycles/FillRowsPanel.jsx';

const h = React.createElement;
const PROBLEM = FILL_PAGES['validate/problem-discovery'];
const SOLUTION = FILL_PAGES['build/solution-design'];
const theme = VALIDATE_FORMS['problem-discovery'][0];

// ── The model ───────────────────────────────────────────────────────────────

test('each founder form FILL_FIELDS lists has a sheet; no other form does', () => {
  assert.deepEqual(fillTarget('validate', 'problem-discovery', 'theme'), { page: PROBLEM, form: 'theme' });
  assert.deepEqual(fillTarget('validate', 'ideal-customer-profile', 'segment')?.form, 'segment');
  assert.deepEqual(fillTarget('validate', 'experiments', 'hypothesis')?.form, 'hypothesis');
  assert.deepEqual(fillTarget('build', 'solution-design', 'feature'), { page: SOLUTION, form: 'feature' });
  assert.deepEqual(fillTarget('build', 'prototype-mvp', 'must-have')?.form, 'must-have');
  for (const [c, s, f] of [['validate', 'market-intelligence', 'competitor'], ['validate', 'demand-signals', 'signal'], ['build', 'product-roadmap', 'item'], ['validate', 'problem-discovery', 'segment'], ['raise', 'pitch-deck', 'theme'], ['validate', 'problem-discovery', '']]) {
    assert.equal(fillTarget(c, s, f), null, `${c}/${s}/${f}`);
  }
  for (const [slug, forms] of Object.entries(VALIDATE_FORMS)) {
    const t = moduleFillTarget('validate', slug, forms);
    assert.equal(!!t, ['problem-discovery', 'ideal-customer-profile', 'experiments'].includes(slug), slug);
  }
  assert.equal(moduleFillTarget('build', 'solution-design', BUILD_FORMS['solution-design']).label, 'Add feature');
  assert.equal(moduleFillTarget('validate', 'problem-discovery', []), null);
});

test('placed values, what Save records, and the saved row', () => {
  const out = placeValues([
    { field: 'title', value: 'Inspections run late', source_kind: 'eadwyn', proposal_uid: 'u1' },
    { field: 'severity', value: 'high', proposal_uid: 'u2' },
    { field: 'quotes', value: null },
  ], ['title']);
  assert.deepEqual(out.values, { title: 'Inspections run late' }, 'a field the read does not list is never placed');
  assert.deepEqual(out.placed, { title: { value: 'Inspections run late', source_kind: 'eadwyn', proposal_uid: 'u1' } });
  assert.equal(stillPlaced(out.placed, 'title', 'Inspections run late'), true);
  assert.equal(stillPlaced(out.placed, 'title', 'Inspections run late, typed over'), false);
  assert.deepEqual(placedProposals({ a: { proposal_uid: 'u1' }, b: { proposal_uid: 'u1' }, c: { proposal_uid: null }, d: {} }), ['u1']);
  assert.equal(savedId({ id: 12 }), 12);
  for (const bad of [null, {}, { id: 0 }, { id: -3 }, { id: 'x' }, { id: 1.5 }]) assert.equal(savedId(bad), null, JSON.stringify(bad));
});

const proposal = (uid, row, extra = {}) => ({ uid, kind: 'proposal', status: 'proposed', payload: { row, table: 'mvp_features', project: 7 }, created_at: '2026-10-27 10:00:00', ...extra });
const LIST = { proposals: [
  proposal('r1', { title: 'Auto-schedule site inspections', effort: 'M' }),
  proposal('r2', { title: 'Crew slot reminders' }),
  proposal('r3', { title: 'Another venture’s row' }, { payload: { row: { title: 'x' }, table: 'mvp_features', project: 8 } }),
  { uid: 'f1', kind: 'proposal', status: 'proposed', payload: { field: 'title', value: 'a field, not a row', project: 7 } },
  proposal('r4', { title: 'Decided' }, { status: 'discarded' }),
] };

test('waiting rows are this venture’s rows only; their lines and Accept all’s report are words', () => {
  assert.deepEqual(waitingRows(LIST, 7).map((r) => r.uid), ['r1', 'r2']);
  assert.deepEqual(waitingRows(null, 7), []);
  assert.deepEqual(rowLines({ title: 'Auto-schedule', effort: 'M', pain_group_id: 3 }, SOLUTION, 'feature'), { title: 'Auto-schedule', rest: ['Effort: M'] }, 'a restatement’s id is never drawn as a line');
  assert.deepEqual(rowLines({ name: 'Ops leads', who_they_are: 'Run crews' }, FILL_PAGES['validate/ideal-customer-profile'], 'segment'), { title: 'Ops leads', rest: ['Who they are: Run crews'] });
  const r = acceptReport({ outcomes: [{ uid: 'r1', outcome: 'created', id: 4 }, { uid: 'r2', outcome: 'refused', why: 'duplicate' }], over_limit: ['r9'] }, 3);
  assert.equal(r.line, 'Added 1 of 3. 1 more wait: Accept all takes 50 at a time.');
  assert.deepEqual(r.refused, [{ uid: 'r2', text: 'One with this name is already on file.' }]);
  assert.equal(acceptReport({ outcomes: [{ uid: 'x', outcome: 'refused', why: 'some_code' }] }, 1).refused[0].text, 'It could not be added.', 'never a bare code');
});

// ── Mounted ─────────────────────────────────────────────────────────────────

async function mount(element, { routes = {} } = {}) {
  const restoreDoc = installDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = function focus() { document.activeElement = this; };
    n.children = []; n.isConnected = true; n.offsetParent = {};
    return n;
  };
  document.querySelectorAll = () => [];
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unrouted ${url}`);
    return routes[key](calls.at(-1));
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(container);
  const byTestId = (id) => all().find((n) => props(n)['data-testid'] === id);
  const allByKind = (id, kind) => all().filter((n) => props(n)['data-testid'] === id && props(n)['data-kind'] === kind);
  const text = (n = container) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const press = async (id) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); };
  const type = async (id, value) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); };
  const submit = async () => { const f = all().find((n) => typeof props(n).onSubmit === 'function'); await act(async () => { await props(f).onSubmit({ preventDefault() {} }); }); await flush(); };
  await flush();
  return {
    calls, props, byTestId, allByKind, text, flush, press, type, submit,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restoreDoc(); },
  };
}
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });

const view = (f, extra = {}) => ({
  field: f, label: f === 'title' ? 'Theme' : f, table: 'pain_groups', column: f, class: 'composition', sources: ['eadwyn'],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [], ...extra,
});
const SHEET = {
  page: PROBLEM, form: 'theme', project: 7, record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: '2026-10-27T10:00:00Z' }],
  fields: [view('title', { waiting: [{ source: 'eadwyn', field: 'title', value: 'Inspections run late', label: 'Eadwyn', ref: 'u-title' }] })],
  quote: { option: 'form:theme', state: 'ok', runs: 2, average_microusd: 900 },
};
const form = (props = {}) => h(FormLightbox, {
  form: theme, cycle: 'validate', slug: 'problem-discovery', onClose() {},
  fill: { page: PROBLEM, form: 'theme', project: 7, aiOff: false }, ...props,
});

test('AF3: the trigger is drawn where the read gives one, and only while the box is blank', async () => {
  const m = await mount(form({ onSubmit: async () => ({ id: 1 }) }), { routes: { '/api/fills/sheet': () => json(SHEET) } });
  try {
    assert.ok(m.byTestId('fill-trigger-title'), 'the field’s trigger');
    assert.match(m.props(m.byTestId('fill-trigger-title'))['aria-label'], /^Ask Eadwyn to fill Theme$/);
    assert.ok(m.byTestId('fill-form-trigger'), 'the form’s Fill');
    assert.equal(m.byTestId('fill-trigger-severity'), undefined, 'a judgement the read does not list has none');
    assert.equal(m.calls.filter((c) => c.url.includes('/api/fills/sheet')).length, 1, 'read once');
    assert.match(m.calls[0].url, /page=Founder%20%C2%B7%20Validate%20%C2%B7%20Problem%20discovery&form=theme&project=7/);
    await m.type('cycle-form-title', 'My own words');
    assert.equal(m.byTestId('fill-trigger-title'), undefined, 'a typed value has no trigger');
  } finally { await m.unmount(); }
  // The Worker decides: a field it gives no trigger (a reader, a never-fill field) has none, even blank.
  const off = await mount(form({ onSubmit: async () => ({ id: 1 }) }), { routes: { '/api/fills/sheet': () => json({ ...SHEET, fields: [view('title', { trigger: false })] }) } });
  try {
    assert.equal(off.byTestId('fill-trigger-title'), undefined);
    assert.equal(off.byTestId('fill-form-trigger'), undefined);
    assert.equal(m.byTestId('fill-form-trigger'), undefined);
  } finally { await m.unmount(); }
});

test('AF7: Accept places "Not saved" and writes nothing; Save writes, then records the saved row', async () => {
  const order = [];
  const m = await mount(form({ onSubmit: async (v) => { order.push(['save', v.title]); return { id: 41 }; } }), {
    routes: {
      '/api/fills/sheet': () => json(SHEET),
      '/api/fills/record': (c) => { order.push(['record', c.body]); return json({ record: 'pain_groups:41', outcomes: [{ uid: 'u-title', outcome: 'kept' }] }); },
    },
  });
  try {
    await m.press('fill-form-trigger');
    assert.ok(m.byTestId('fill-sheet'), 'the one sheet');
    await m.press('fill-sheet-preview');
    await m.press('fill-sheet-accept-all');
    assert.equal(m.props(m.byTestId('cycle-form-title')).value, 'Inspections run late', 'placed in the open form');
    assert.equal(m.allByKind('fill-mark', 'placed').length, 1, '“Not saved”');
    assert.match(m.text(m.byTestId('fill-form-placed')), /1 value placed\. Nothing is saved until you press Create theme\./);
    assert.equal(m.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing is written before Save');
    await m.submit();
    assert.deepEqual(order, [['save', 'Inspections run late'], ['record', { page: PROBLEM, form: 'theme', project: 7, record: 41, proposals: ['u-title'] }]]);
  } finally { await m.unmount(); }
});

test('a placed value typed over loses its mark; Save still names the proposal so the Worker discards it', async () => {
  const recorded = [];
  const m = await mount(form({ onSubmit: async () => ({ id: 42 }) }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': (c) => { recorded.push(c.body); return json({ outcomes: [] }); } },
  });
  try {
    await m.press('fill-form-trigger'); await m.press('fill-sheet-preview'); await m.press('fill-sheet-accept-all');
    await m.type('cycle-form-title', 'Inspections run late, in my words');
    assert.equal(m.allByKind('fill-mark', 'placed').length, 0);
    await m.submit();
    assert.deepEqual(recorded.map((b) => b.proposals), [['u-title']]);
  } finally { await m.unmount(); }
});

test('a Save whose reply names no row records nothing', async () => {
  const seen = [];
  const m = await mount(form({ onSubmit: async () => ({ ok: true }) }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': () => { seen.push(1); return json({}); } },
  });
  try {
    await m.press('fill-form-trigger'); await m.press('fill-sheet-preview'); await m.press('fill-sheet-accept-all');
    await m.submit();
    assert.deepEqual(seen, []);
  } finally { await m.unmount(); }
});

test('a Save that fails records nothing; a record that fails does not undo the Save', async () => {
  const seen = [];
  const m = await mount(form({ onSubmit: async () => { throw new Error('A theme needs a title'); } }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': () => { seen.push(1); return json({}); } },
  });
  try {
    await m.press('fill-form-trigger'); await m.press('fill-sheet-preview'); await m.press('fill-sheet-accept-all');
    await m.submit();
    assert.deepEqual(seen, []);
    assert.match(m.text(m.byTestId('cycle-form-refusal')), /A theme needs a title/);
  } finally { await m.unmount(); }
  let saved = 0;
  const k = await mount(form({ onSubmit: async () => ({ id: 43 }), onSaved: () => { saved += 1; } }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': () => json({ detail: 'boom' }, 500) },
  });
  try {
    await k.press('fill-form-trigger'); await k.press('fill-sheet-preview'); await k.press('fill-sheet-accept-all');
    await k.submit();
    assert.equal(saved, 1, 'the form’s own Save still counts');
  } finally { await k.unmount(); }
});

test('an unreadable read says so, draws no trigger, and Try again reads it again', async () => {
  let n = 0;
  const m = await mount(form({ onSubmit: async () => ({ id: 1 }) }), { routes: { '/api/fills/sheet': () => { n += 1; return n === 1 ? json({ detail: 'x' }, 500) : json(SHEET); } } });
  try {
    assert.match(m.text(m.byTestId('fill-form-unreadable')), /^Unreadable: Eadwyn's suggestions for this form could not be read\./);
    assert.equal(m.byTestId('fill-trigger-title'), undefined);
    await m.press('fill-form-retry');
    assert.equal(n, 2);
    assert.ok(m.byTestId('fill-trigger-title'));
  } finally { await m.unmount(); }
});

test('a form with no fill reads nothing and draws no trigger; AI off draws the neutral words', async () => {
  const m = await mount(form({ fill: null, onSubmit: async () => ({ id: 1 }) }), { routes: {} });
  try {
    assert.equal(m.calls.length, 0);
    assert.equal(m.byTestId('fill-form-trigger'), undefined);
  } finally { await m.unmount(); }
  const k = await mount(form({ fill: { page: PROBLEM, form: 'theme', project: 7, aiOff: true }, onSubmit: async () => ({ id: 1 }) }), { routes: { '/api/fills/sheet': () => json(SHEET) } });
  try {
    assert.equal(k.props(k.byTestId('fill-trigger-title'))['aria-label'], 'Ask to fill Theme from your sources');
  } finally { await k.unmount(); }
});

test('a waiting row’s Edit opens the form with its values "Not saved", and Save decides it as edited', async () => {
  const decided = [];
  const m = await mount(form({ fill: { page: PROBLEM, form: 'theme', project: 7, edited: { uid: 'r9', row: { title: 'Crews miss their slots' } } }, onSubmit: async () => ({ id: 50 }) }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/ai/rail/proposals/r9/decide': (c) => { decided.push(c.body); return json({ proposal: {} }); } },
  });
  try {
    assert.equal(m.props(m.byTestId('cycle-form-title')).value, 'Crews miss their slots');
    assert.equal(m.allByKind('fill-mark', 'placed').length, 1);
    await m.submit();
    assert.deepEqual(decided, [{ decision: 'edit', payload: { row: { title: 'Crews miss their slots' } } }]);
  } finally { await m.unmount(); }
});

// ── The module (AF1, AF16) ──────────────────────────────────────────────────

const TARGET = { page: SOLUTION, form: 'feature', label: 'Add feature' };
const module = (props = {}) => h(FillModule, { target: TARGET, projectId: 7, moduleName: 'Solution design', ...props });

test('AF1: "N waiting" counts this venture’s rows; an unreadable read draws no count', async () => {
  const m = await mount(module(), { routes: { '/api/ai/rail/proposals?': () => json(LIST) } });
  try {
    assert.match(m.calls[0].url, /\/api\/ai\/rail\/proposals\?option=form%3Afeature&status=proposed/);
    assert.equal(m.text(m.byTestId('fill-module-waiting')), '2 waiting');
    assert.equal(m.props(m.byTestId('fill-module-trigger'))['aria-label'], 'Ask Eadwyn, 2 waiting');
  } finally { await m.unmount(); }
  const k = await mount(module(), { routes: { '/api/ai/rail/proposals?': () => json({ detail: 'x' }, 500) } });
  try {
    assert.equal(k.byTestId('fill-module-waiting'), undefined, 'never "0 waiting" for a failed read');
    assert.equal(k.props(k.byTestId('fill-module-trigger'))['aria-label'], 'Ask Eadwyn');
    await k.press('fill-module-trigger');
    assert.match(k.text(k.byTestId('fill-rows-unreadable')), /This is not a claim that none is waiting\./);
  } finally { await k.unmount(); }
});

test('AF16: Accept and Accept all go through rows/accept, each refusal in words; Edit hands the row on', async () => {
  const accepted = [];
  const edits = [];
  let changed = 0;
  const m = await mount(module({ onEdit: (p) => edits.push(p), onChanged: () => { changed += 1; } }), {
    routes: {
      '/api/ai/rail/proposals?': () => json(LIST),
      '/api/fills/rows/accept': (c) => { accepted.push(c.body); return json({ outcomes: [{ uid: 'r1', outcome: 'created', id: 9 }, { uid: 'r2', outcome: 'refused', why: 'invalid' }], over_limit: [] }); },
    },
  });
  try {
    await m.press('fill-module-trigger');
    assert.match(m.text(m.byTestId('fill-rows-panel')), /2 proposals for Solution design/);
    assert.match(m.text(m.byTestId('fill-rows-item-r1')), /Add feature Auto-schedule site inspections\?/);
    assert.equal(m.byTestId('fill-rows-item-r3'), undefined, 'another venture’s row is not here');
    assert.equal(m.text(m.byTestId('fill-rows-accept-all')), 'Accept all (2)');
    await m.press('fill-rows-accept-all');
    assert.deepEqual(accepted, [{ page: SOLUTION, form: 'feature', project: 7, proposals: ['r1', 'r2'] }]);
    assert.equal(m.text(m.byTestId('fill-rows-report')), 'Added 1 of 2.');
    assert.equal(m.text(m.byTestId('fill-rows-why-r2')), 'It is missing something its form needs.');
    assert.equal(changed, 1, 'the page re-reads once a row was added');
    await m.press('fill-rows-accept-r1');
    assert.deepEqual(accepted[1].proposals, ['r1'], 'one row');
    await m.press('fill-rows-edit-r2');
    assert.deepEqual(edits.map((p) => [p.uid, p.row.title]), [['r2', 'Crew slot reminders']]);
  } finally { await m.unmount(); }
});

test('AF16: Accept all takes at most 50', async () => {
  const sent = [];
  const many = { proposals: Array.from({ length: 51 }, (_, i) => proposal(`m${i}`, { title: `Row ${i}` })) };
  const m = await mount(module(), { routes: { '/api/ai/rail/proposals?': () => json(many), '/api/fills/rows/accept': (c) => { sent.push(c.body.proposals.length); return json({ outcomes: [], over_limit: [] }); } } });
  try {
    await m.press('fill-module-trigger');
    assert.equal(m.text(m.byTestId('fill-rows-accept-all')), 'Accept all (50)');
    await m.press('fill-rows-accept-all');
    assert.deepEqual(sent, [50]);
  } finally { await m.unmount(); }
});

test('AF16: Discard is one decision each; Discard all asks first; Ask is off while AI is off', async () => {
  const decided = [];
  const m = await mount(module({ aiOff: true }), {
    routes: {
      '/api/ai/rail/proposals?': () => json(LIST),
      '/decide': (c) => { decided.push([c.url.match(/proposals\/([^/]+)\/decide/)[1], c.body.decision]); return json({ proposal: {} }); },
    },
  });
  try {
    await m.press('fill-module-trigger');
    assert.equal(m.props(m.byTestId('fill-rows-ask')).disabled, true);
    await m.press('fill-rows-discard-all');
    assert.deepEqual(decided, [], 'nothing before the dialog');
    assert.ok(m.byTestId('fill-rows-confirm'));
    await m.press('fill-rows-confirm-discard');
    assert.deepEqual(decided, [['r1', 'discard'], ['r2', 'discard']]);
    assert.equal(m.text(m.byTestId('fill-rows-report')), 'Discarded 2.');
  } finally { await m.unmount(); }
});

test('AF16: Ask Eadwyn runs the form’s handler for rows; a refusal is a sentence, never a code', async () => {
  const runs = [];
  const m = await mount(module(), {
    routes: {
      '/api/ai/rail/proposals?': () => json({ proposals: [] }),
      '/api/ai/rail/run': (c) => { runs.push(c.body); return { ok: true, status: 200, json: async () => ({}), text: async () => 'event: done\ndata: {"refusal":{"code":"assist_off","status":403,"message":"assist_off"}}' }; },
    },
  });
  try {
    await m.press('fill-module-trigger');
    assert.match(m.text(m.byTestId('fill-rows-none')), /Nothing is waiting for Solution design\./);
    await m.press('fill-rows-ask');
    assert.deepEqual(runs, [{ page: SOLUTION, option: 'form:feature', project: 7, input: { rows: 5 } }]);
    assert.doesNotMatch(m.text(m.byTestId('fill-rows-ask-note')), /assist_off/);
  } finally { await m.unmount(); }
});

// ── The phone and the wiring ────────────────────────────────────────────────

test('AF23 and the wiring: Sources a bottom sheet, Preview full height, 44px targets; the founder forms are mounted', () => {
  const sheet = readFileSync(new URL('../src/ui/FillSheet.jsx', import.meta.url), 'utf8');
  assert.match(sheet, /phone=\{step === 'sources' && read\.status !== 'error' && !nothingToFill \? 'sheet' : 'full'\}/);
  for (const name of ['BTN', 'GHOST']) assert.match(sheet, new RegExp(`const ${name} = '[^']*max-sm:min-h-\\[44px\\]'`), name);
  const panel = readFileSync(new URL('../src/pages/cycles/FillRowsPanel.jsx', import.meta.url), 'utf8');
  for (const name of ['BTN', 'GHOST']) assert.match(panel, new RegExp(`const ${name} = '[^']*max-sm:min-h-\\[44px\\]'`), name);
  assert.match(panel, /max-sm:sticky max-sm:bottom-0/, 'Accept all stays in reach');
  assert.ok(!/\b(window\.)?(alert|confirm|prompt)\(/.test(panel));
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /fill=\{fillFor\(formOpen\)\}/);
  assert.match(route, /: moduleFill \? <FillModule /);
  const lightbox = readFileSync(new URL('../src/pages/cycles/FormLightbox.jsx', import.meta.url), 'utf8');
  assert.match(lightbox, /const result = await onSubmit\(sent\);\n\s*await afterSave\(result, sent\);/, 'record only after the form’s own Save');
});

// ── #3740 part 1: Ask on the Edit forms, the KPI form, and the mount guard ───

const { EDIT_FILL_FORMS, fillRecordId } = await import('../src/lib/fillForms.js');
const { editFor } = await import('../src/pages/cycles/forms.js');
const { FILL_FIELDS } = await import('../src/lib/fillFields.js');

/** The six Edit forms #3740 names: cycle, module, Edit key, the FILL form, and the field the test leaves blank. */
const EDITS_3740 = [
  ['validate', 'problem-discovery', 'edit-theme', 'theme', 'title'],
  ['validate', 'ideal-customer-profile', 'edit-segment', 'segment', 'name'],
  ['validate', 'experiments', 'edit-hypothesis', 'hypothesis', 'claim'],
  ['build', 'solution-design', 'edit-feature', 'feature', 'title'],
  ['build', 'prototype-mvp', 'edit-must-have', 'must-have', 'title'],
  ['grow', 'revenue-and-traction', 'edit-kpi', 'kpi', 'value'],
];

test('#3740: each Edit form fills its FILL form, and a row id is sent as record only when it is a row', () => {
  for (const [cycle, slug, key, form] of EDITS_3740) {
    assert.equal(editFor(cycle, slug)?.key, key, `${cycle}/${slug} edits with ${key}`);
    assert.equal(EDIT_FILL_FORMS[key], form);
    assert.deepEqual(fillTarget(cycle, slug, key), { page: FILL_PAGES[`${cycle}/${slug}`], form }, key);
  }
  assert.equal(FILL_PAGES['grow/revenue-and-traction'], 'Founder · Grow · Revenue and traction');
  assert.deepEqual(fillTarget('grow', 'revenue-and-traction', 'kpi')?.form, 'kpi', 'the KPI Add form has its sheet');
  assert.equal(fillRecordId(41), 41);
  assert.equal(fillRecordId('41'), 41);
  for (const bad of ['mrr', 'custom-ab1', 0, -2, 1.5, null, undefined, '4x']) assert.equal(fillRecordId(bad), null, String(bad));
});

const editSheet = (page, form, field, extra = {}) => ({
  page, form, project: 7, record: 41, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: '2026-10-27T10:00:00Z' }],
  fields: [view(field, { label: field, ...extra })], quote: { option: `form:${form}`, state: 'ok', runs: 1, average_microusd: 900 },
});

for (const [cycle, slug, key, form, field] of EDITS_3740.filter((e) => e[2] !== 'edit-kpi')) {
  test(`#3740: ${key} draws Ask on a blank field, reads its row (record), and none on a filled field`, async () => {
    const page = FILL_PAGES[`${cycle}/${slug}`];
    const edit = editFor(cycle, slug);
    const fill = { ...fillTarget(cycle, slug, key), project: 7, aiOff: false, record: fillRecordId(41) };
    const routes = { '/api/fills/sheet': () => json(editSheet(page, form, field)), '/api/cycles/': () => json({}) };
    const blank = await mount(h(FormLightbox, { form: edit, current: { [field]: '' }, cycle, slug, onClose() {}, onSubmit: async () => ({ ok: true }), fill }), { routes });
    try {
      assert.ok(blank.byTestId(`fill-trigger-${field}`), `${key}: the blank field's Ask`);
      assert.ok(blank.byTestId('fill-form-trigger'), `${key}: the form's Ask`);
      const read = blank.calls.find((c) => c.url.includes('/api/fills/sheet'));
      assert.match(read.url, new RegExp(`form=${encodeURIComponent(form)}&project=7&record=41$`), `${key}: the sheet read names the row`);
    } finally { await blank.unmount(); }
    const filled = await mount(h(FormLightbox, { form: edit, current: { [field]: 'Already written' }, cycle, slug, onClose() {}, onSubmit: async () => ({ ok: true }), fill }), { routes });
    try {
      assert.equal(filled.byTestId(`fill-trigger-${field}`), undefined, `${key}: a filled field draws no Ask`);
    } finally { await filled.unmount(); }
  });
}

test('#3740: an Edit Save records against the edited row when the reply names none', async () => {
  const recorded = [];
  const fill = { ...fillTarget('validate', 'problem-discovery', 'edit-theme'), project: 7, aiOff: false, record: 41 };
  const m = await mount(h(FormLightbox, { form: editFor('validate', 'problem-discovery'), current: { title: '' }, cycle: 'validate', slug: 'problem-discovery', onClose() {}, onSubmit: async () => ({ ok: true }), fill }), {
    routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': (c) => { recorded.push(c.body); return json({ outcomes: [] }); } },
  });
  try {
    await m.press('fill-form-trigger'); await m.press('fill-sheet-preview'); await m.press('fill-sheet-accept-all');
    await m.submit();
    assert.deepEqual(recorded.map((b) => [b.record, b.proposals]), [[41, ['u-title']]]);
  } finally { await m.unmount(); }
});

test('#3740: the KPI form draws Ask with the neutral glyph, and its sheet lists only Stripe and Mercury', async () => {
  const kpiForm = editFor('grow', 'revenue-and-traction');
  const page = FILL_PAGES['grow/revenue-and-traction'];
  const kpiFields = FILL_FIELDS.filter((f) => f.page === page && f.form === 'kpi');
  assert.deepEqual(kpiFields.map((f) => [f.field, f.class, f.sources]), [['value', 'measured', ['connector:stripe', 'connector:mercury']]]);
  const sheet = { ...editSheet(page, 'kpi', 'value', { class: 'measured', sources: ['connector:stripe', 'connector:mercury'], offered_to_eadwyn: false }),
    sources: [{ key: 'connector:stripe', kind: 'connector', label: 'Stripe', state: 'ok' }, { key: 'connector:mercury', kind: 'connector', label: 'Mercury', state: 'ok' }], record: null };
  const fill = { ...fillTarget('grow', 'revenue-and-traction', 'edit-kpi'), project: 7, aiOff: false, record: fillRecordId('mrr') };
  assert.equal(fill.record, null, 'a KPI names no row');
  const m = await mount(h(FormLightbox, { form: kpiForm, current: {}, cycle: 'grow', slug: 'revenue-and-traction', onClose() {}, onSubmit: async () => ({ ok: true }), fill }), {
    routes: { '/api/fills/sheet': () => json(sheet), '/api/cycles/': () => json({ sources: [] }) },
  });
  try {
    const trigger = m.byTestId('fill-form-trigger');
    assert.ok(trigger, 'the KPI form draws Ask');
    assert.equal(m.props(trigger)['aria-label'], 'Ask (from your sources)', 'the neutral glyph: no field is offered to Eadwyn');
    assert.doesNotMatch(m.calls.find((c) => c.url.includes('/api/fills/sheet')).url, /record=/);
  } finally { await m.unmount(); }
});

// The guard: every (page, form) FILL_FIELDS lists has an Add mount and an Edit mount that pass `fill`, or a named exemption.
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const FOUNDER = { theme: ['validate', 'problem-discovery'], segment: ['validate', 'ideal-customer-profile'], hypothesis: ['validate', 'experiments'],
  feature: ['build', 'solution-design'], 'must-have': ['build', 'prototype-mvp'], kpi: ['grow', 'revenue-and-traction'] };
const MOUNTS = {
  'Investor · Deals · Commit | ic-memo': { add: 'exempt: an IC decision is opened by the decision flow, and its memo is written on the decision page', edit: ['pages/ICDecisionPage.jsx', /scope: SCOPED_FORMS\.icMemo, record:/] },
  'Advisor · Expertise · Services | service': { add: ['pages/advisor/expertise/ServicesZone.jsx', /scope: SCOPED_FORMS\.service/], edit: 'exempt: Services has no Edit form today; the advisor sections are redrawn under #3700' },
  'Operating Partner · Delivery · Reporting | status-report': { add: ['pages/partner/delivery/StatusReportsZone.jsx', /parent: reportId \? null/], edit: ['pages/partner/delivery/StatusReportsZone.jsx', /record: reportId/] },
  'Admin · Approvals · Events | event': { add: 'exempt: /events/new is an owner call, under #3724', edit: ['pages/events/EventEditorPage.jsx', /record: isEdit \? Number\(id\) : null/] },
  'Admin · Approvals · Events | agenda-item': { add: ['pages/events/EventManagePage.jsx', /parent: editing \? null : Number\(id\)/], edit: ['pages/events/EventManagePage.jsx', /record: editing \?\? null/] },
  'Super Admin · Content · Publications | publication': { add: 'exempt: a publication is created from its source, then its summary is written on its detail page', edit: ['pages/admin/PublicationDetail.jsx', /scope: SCOPED_FORMS\.publication, record: pubId/] },
  // D1424 (#3700) mounted D1595's three forms.
  'Investor · Portfolio · Value-add | support': { add: ['pages/investor/InvestorPortfolioValueAdd.jsx', /scope: SCOPED_FORMS\.support, parent: parentId/], edit: 'exempt: an entry is delivered, withdrawn or amended on its row (PATCH), and no form re-opens its summary' },
  'Operating Partner · Offers · Catalog | offering': { add: ['pages/ServiceCatalogPage.jsx', /parent: offering \? null : ownerId/], edit: ['pages/ServiceCatalogPage.jsx', /record: offering\?\.id \?\? null/] },
  'Operating Partner · Offers · Perk deals | perk': { add: ['pages/PerksPage.jsx', /scope: SCOPED_FORMS\.perk, parent: ownerId/], edit: 'exempt: a submitted perk is reviewed before it lists, and this console edits only its end date (Extend)' },
};

test('#3740 guard: every FILL_FIELDS form has an Add mount and an Edit mount that pass fill, or a named exemption', async () => {
  const { FORMS } = await import('../src/pages/cycles/forms.js');
  const cycleRoute = src('pages/cycles/CycleRoute.jsx');
  // The three Edit mounts and the Add mount in CycleRoute pass `fill`.
  assert.match(cycleRoute, /fill=\{fillFor\(formOpen\)\}/, 'the Add mount');
  assert.match(cycleRoute, /fill=\{fillFor\(rowEdit\.spec\.form, rowEdit\.spec\.id\)\}/, 'the row Edit mount');
  assert.match(cycleRoute, /fill=\{fillFor\(edit, edit\.idOf\(editing\)\)\}/, 'the Edit mount');
  assert.match(cycleRoute, /fill=\{selected\.key === 'edit' \? fillFor\(formSpec\.form, formSpec\.id\) : null\}/, 'the record page\'s Edit');
  const pairs = [...new Set(FILL_FIELDS.map((f) => `${f.page} | ${f.form}`))];
  for (const pair of pairs) {
    const [page, form] = pair.split(' | ');
    if (page.startsWith('Founder · ')) {
      const [cycle, slug] = FOUNDER[form] || [];
      assert.ok(cycle, `${pair}: a founder form the guard does not know`);
      const adds = (FORMS[cycle]?.[slug] || []).map((f) => f.key);
      assert.ok(adds.some((k) => fillTarget(cycle, slug, k)?.form === form), `${pair}: no Add mount fills it`);
      const editKey = editFor(cycle, slug)?.key;
      assert.equal(fillTarget(cycle, slug, editKey)?.form, form, `${pair}: its Edit (${editKey}) does not fill it`);
      continue;
    }
    const m = MOUNTS[pair];
    assert.ok(m, `${pair}: a FILL_FIELDS form with no Add or Edit mount and no exemption`);
    for (const side of ['add', 'edit']) {
      const v = m[side];
      if (typeof v === 'string') { assert.match(v, /^exempt: .{10,}/, `${pair} ${side}: an exemption names its reason`); continue; }
      assert.match(src(v[0]), v[1], `${pair} ${side}: ${v[0]} lost its mount`);
    }
  }
  assert.deepEqual(Object.keys(MOUNTS).filter((k) => !pairs.includes(k)), [], 'an exemption for a form FILL_FIELDS no longer lists');
});
