// #4046 (#3740 2b): Ask on the deal page's New note, the pages half.
//   - the model: `SCOPED_FORMS.dealNote` is FILL_FIELDS' one composition field, on deal_notes; its tag is never filled;
//   - the Notes tab, mounted against a stubbed fetch: the read names the deal as the parent and never a venture;
//     a blank note draws the field's trigger and the form's Ask; a placed value is "Not saved" and nothing is
//     written until Save; Save posts the note through the notes route, then records the placed proposal against
//     the id the route returns; a typed note draws no trigger; a refused read (another firm, an admin) shows nothing;
//   - the draft slot says what Ask drafts from, and that a summary of the whole record is not read yet.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_deal_notes_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { FILL_FIELDS, fieldsOf } from '../src/lib/fillFields.js';
import { EADWYN_DRAFT_WAITS } from '../src/pages/deal/dealFrameModel.js';
import DealNotes from '../src/pages/deal/DealNotes.jsx';

const h = React.createElement;
const DEAL = SCOPED_FORMS.dealNote;

test('the model: one composition field, the note\'s words, on deal_notes; the tag is the investor\'s to choose', () => {
  assert.deepEqual(DEAL, { page: 'Investor · Deals · Deal room', form: 'deal-note', table: 'deal_notes' });
  assert.deepEqual(fieldsOf(DEAL.page, DEAL.form).map((f) => [f.field, f.table, f.column, f.class]), [['body', 'deal_notes', 'body', 'composition']]);
  assert.ok(!FILL_FIELDS.some((f) => f.table === 'deal_notes' && f.column === 'tag'), 'the tag is never listed');
  assert.match(NOT_FILLED_HERE['deal-note'][0], /^Tag/);
  assert.match(EADWYN_DRAFT_WAITS, /^Ask on New note drafts a note/);
  assert.match(EADWYN_DRAFT_WAITS, /Nothing lands until you save it as your note\./);
  assert.match(EADWYN_DRAFT_WAITS, /whole record is not read here yet/, 'what is still not read stays said');
});

async function mount(element, routes) {
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
  const realStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(' '); return m === call.method && call.url.includes(p); });
    if (!key) throw new Error(`unrouted ${call.method} ${url}`);
    return routes[key](call);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n = container) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const press = async (id) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); };
  const type = async (id, value) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); };
  await flush();
  return {
    calls, byTestId, text, flush, press, type, props,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = realFetch; globalThis.localStorage = realStorage; restoreDoc(); },
  };
}
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });

const SHEET = (extra = {}) => ({
  page: DEAL.page, form: DEAL.form, project: null, scope: 'deal:900', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }],
  fields: [{ field: 'body', label: 'Note', table: 'deal_notes', column: 'body', class: 'composition', sources: ['eadwyn'], value: null, mark: null,
    never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [] }],
  quote: { option: 'form:deal-note', state: 'ok', runs: 0, average_microusd: null }, ...extra,
});
const NOTES = { items: [], total: 0 };

test('the New note form: the read names the deal, never a venture; a blank note draws Ask; the tag is said to be the investor\'s', async () => {
  // Mutation checked: the mount's `parent` dropped → the read carries no parent=900.
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), {
    'GET /deals/900/notes': () => json(NOTES), 'GET /api/fills/sheet': () => json(SHEET()),
  });
  try {
    const sheet = w.calls.find((c) => c.url.includes('/api/fills/sheet'));
    assert.match(sheet.url, /parent=900/);
    assert.match(sheet.url, /form=deal-note/);
    assert.doesNotMatch(sheet.url, /project=/, 'a firm\'s note names no venture');
    assert.ok(w.byTestId('fill-trigger-body'), 'the field\'s trigger on a blank note');
    assert.ok(w.byTestId('fill-form-trigger'), 'the form\'s Ask');
    assert.match(w.text(w.byTestId('fill-scoped-not-here')), /Tag · it is yours to choose\./);
    await w.type('deal-note-body', 'Typed by me.');
    assert.equal(w.byTestId('fill-trigger-body'), undefined, 'a typed note draws no trigger');
  } finally { await w.unmount(); }
});

test('Save posts the note through the notes route, then records the placed proposal against the id it returns', async () => {
  // Mutations checked: `fill.afterSave` dropped from Save → no record call; the created id not passed → no record call.
  const value = 'Second call: the pilot list holds; ask for churn by cohort.';
  const sse = [
    `event: done\ndata: ${JSON.stringify({ proposals: [{ uid: 'p-1', field: 'body', value }], dropped: [], charged_microusd: 1200 })}\n\n`,
  ].join('');
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), {
    'GET /deals/900/notes': () => json(NOTES), 'GET /api/fills/sheet': () => json(SHEET()),
    'POST /api/ai/rail/run': () => ({ ok: true, status: 200, headers: new Map(), text: async () => sse, json: async () => ({}) }),
    'POST /deals/900/notes': () => json({ uid: 'n-9', id: 709 }, 201), 'POST /api/fills/record': () => json({ outcomes: [{ outcome: 'kept' }] }),
  });
  try {
    await w.press('fill-form-trigger');
    await w.press('fill-sheet-preview');
    const run = w.calls.find((c) => c.url.includes('/api/ai/rail/run'));
    assert.deepEqual([run.body.option, run.body.parent, run.body.project], ['form:deal-note', 900, undefined], 'the run names the deal, never a venture');
    await w.press('fill-sheet-accept-all');
    assert.equal(w.byTestId('deal-note-body').value, value, 'Accept places the words in the note');
    assert.match(w.text(w.byTestId('fill-label-body')), /Not saved/);
    assert.ok(w.calls.every((c) => !c.url.includes('/api/fills/record')), 'nothing is recorded before Save');
    await w.press('deal-note-save');
    const posted = w.calls.find((c) => c.method === 'POST' && c.url.includes('/deals/900/notes'));
    assert.deepEqual(posted.body, { body: value, tag: null }, 'the notes route writes the note');
    const rec = w.calls.find((c) => c.url.includes('/api/fills/record'));
    assert.ok(rec, 'Save records the placed proposal');
    assert.deepEqual(rec.body, { page: DEAL.page, form: 'deal-note', record: 709, proposals: ['p-1'] });
  } finally { await w.unmount(); }
});

test('a refused read (another firm, an admin, no staff bypass) draws no Ask and no error on the form', async () => {
  const w = await mount(h(DealNotes, { dealId: 900, userId: 51 }), {
    'GET /deals/900/notes': () => json(NOTES), 'GET /api/fills/sheet': () => json({ error: 'record_not_found' }, 404),
  });
  try {
    assert.equal(w.byTestId('fill-scoped-bar'), undefined);
    assert.equal(w.byTestId('fill-trigger-body'), undefined);
    assert.equal(w.byTestId('fill-scoped-unreadable'), undefined, 'a refusal is not an unreadable read');
    assert.ok(w.byTestId('deal-note-save'), 'the form works as it is');
  } finally { await w.unmount(); }
});

test('the author’s Edit dialog reads Fill against the note record and saves through the notes route', async () => {
  const note = { id: 501, uid: 'n-1', author_user_id: 41, body: 'Original note', tag: null };
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), {
    'GET /deals/900/notes': () => json({ items: [note], total: 1 }),
    'GET /api/fills/sheet': (c) => json(c.url.includes('record=501')
      ? SHEET({ record: 501, fields: [{ ...SHEET().fields[0], value: note.body, trigger: false }] }) : SHEET()),
    'PUT /deals/900/notes/n-1': () => json({ ok: true }),
  });
  try {
    await w.press('deal-note-edit-n-1');
    const read = w.calls.find(c => c.url.includes('/api/fills/sheet') && c.url.includes('record=501'));
    assert.ok(read, 'Edit names the existing note');
    assert.ok(!read.url.includes('parent=') && !read.url.includes('project='), 'Edit is scoped to its note, not an Add form');
    const dialog = w.byTestId('deal-note-edit-dialog');
    assert.ok(dialog);
    const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
    const textarea = walk(dialog).find(n => w.props(n)['aria-label'] === 'Note');
    assert.ok(textarea);
    await act(async () => { w.props(textarea).onChange({ target: { value: 'Revised by the author' } }); });
    await w.press('deal-note-edit-confirm');
    assert.deepEqual(w.calls.find(c => c.method === 'PUT').body, { body: 'Revised by the author', tag: null });
    assert.equal(w.byTestId('deal-note-edit-dialog'), undefined, 'the saved Edit closes');
  } finally { await w.unmount(); }
});
