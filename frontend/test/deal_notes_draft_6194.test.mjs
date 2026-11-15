// #6194: DL14's "Draft: deal summary", the pages half.
//   - the draft is asked for, never made on page load: mounting runs no model;
//   - Draft a deal summary runs the deal note's scoped fill with `draft: 'deal_summary'`, under the deal;
//   - the draft is marked as Eadwyn's and "Not saved"; it names its sources, with Not shared and Unreadable said;
//   - Save as my note posts the note through the notes route, then records the proposal against its id;
//   - Discard writes no note and marks the proposal discarded;
//   - a refusal says why; AI off and a reader who may not fill draw no live button.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_notes_draft_6194.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { draftSourceRows } from '../src/pages/deal/dealFrameModel.js';
import DealNotes from '../src/pages/deal/DealNotes.jsx';

const h = React.createElement;
const DEAL = SCOPED_FORMS.dealNote;

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
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
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
const SUMMARY = 'Acme Field raises on a SAFE, closing 31 December.\nYour diligence case is in review, with one open high finding.';
const SOURCES = [
  { key: 'deal', label: 'The deal', state: 'used', note: 'Its company and stage.' },
  { key: 'terms', label: 'The deal\'s terms', state: 'used', note: 'Instrument, target raise and closing date, as the deal states them.' },
  { key: 'evidence', label: 'Shared evidence', state: 'not_shared', note: 'The NDA is not signed, and nothing is shared before it.' },
  { key: 'diligence', label: 'Your diligence case', state: 'unreadable', note: 'Your diligence case could not be read.' },
  { key: 'notes', label: 'Your firm\'s notes', state: 'used', note: 'The last 1 on this deal.' },
];
const stream = (done) => ({ ok: true, status: 200, headers: new Map(), text: async () => `event: done\ndata: ${JSON.stringify(done)}\n\n`, json: async () => ({}) });
const routes = (extra = {}) => ({
  'GET /deals/900/notes': () => json(NOTES), 'GET /api/fills/sheet': () => json(SHEET()),
  'POST /api/ai/rail/run': () => stream({ proposals: [{ uid: 'p-7', field: 'body', value: SUMMARY }], dropped: [], charged_microusd: 1800, sources: SOURCES }),
  'POST /deals/900/notes': () => json({ uid: 'n-9', id: 709 }, 201),
  'POST /api/fills/record': () => json({ outcomes: [{ outcome: 'kept' }] }),
  'POST /api/ai/rail/proposals/p-7/decide': () => json({ proposal: { uid: 'p-7', status: 'discarded' } }),
  ...extra,
});

test('the draft is asked for, never made on load; asking runs the note\'s own fill for a deal summary under the deal', async () => {
  // Mutation checked: `ask` called from an effect on mount → a run call before the press.
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes());
  try {
    assert.match(w.text(w.byTestId('deal-eadwyn-draft')), /Draft: deal summary from the evidence and diligence so far/);
    assert.match(w.text(w.byTestId('deal-eadwyn-draft')), /Nothing behind an unsigned NDA is used/);
    assert.equal(w.calls.filter((c) => c.url.includes('/api/ai/rail/run')).length, 0, 'nothing runs on load');
    await w.press('deal-eadwyn-draft-ask');
    const runs = w.calls.filter((c) => c.url.includes('/api/ai/rail/run'));
    assert.equal(runs.length, 1);
    assert.deepEqual([runs[0].body.option, runs[0].body.parent, runs[0].body.project, runs[0].body.input.draft], ['form:deal-note', 900, undefined, 'deal_summary']);
  } finally { await w.unmount(); }
});

test('the draft is Eadwyn\'s and Not saved, and names its sources with what was not shared or not readable', async () => {
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes());
  try {
    await w.press('deal-eadwyn-draft-ask');
    assert.equal(w.text(w.byTestId('deal-eadwyn-draft-mark')), 'Eadwyn’s draft · Not saved');
    assert.equal(w.text(w.byTestId('deal-eadwyn-draft-text')), SUMMARY);
    assert.match(w.text(w.byTestId('deal-eadwyn-draft-source-evidence')), /Shared evidence · Not shared · The NDA is not signed/);
    assert.match(w.text(w.byTestId('deal-eadwyn-draft-source-diligence')), /Your diligence case · Unreadable/);
    assert.match(w.text(w.byTestId('deal-eadwyn-draft-source-terms')), /Used/);
    assert.equal(w.calls.filter((c) => c.method === 'POST' && c.url.includes('/deals/900/notes')).length, 0, 'nothing is saved yet');
  } finally { await w.unmount(); }
});

test('Save as my note saves through the notes route, then records the proposal against the new id', async () => {
  // Mutation checked: the record step dropped → no /api/fills/record call.
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes());
  try {
    await w.press('deal-eadwyn-draft-ask');
    await w.press('deal-eadwyn-draft-save');
    const saved = w.calls.find((c) => c.method === 'POST' && c.url.includes('/deals/900/notes'));
    assert.deepEqual(saved.body, { body: SUMMARY, tag: null });
    const rec = w.calls.find((c) => c.url.includes('/api/fills/record'));
    assert.deepEqual([rec.body.form, rec.body.record, rec.body.proposals], ['deal-note', 709, ['p-7']]);
    assert.equal(w.byTestId('deal-eadwyn-draft-mark'), undefined, 'the draft is gone once saved');
    assert.ok(w.calls.filter((c) => c.method === 'GET' && c.url.includes('/deals/900/notes')).length >= 2, 'the notes are read again');
  } finally { await w.unmount(); }
});

test('Discard writes no note and marks the proposal discarded', async () => {
  const w = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes());
  try {
    await w.press('deal-eadwyn-draft-ask');
    await w.press('deal-eadwyn-draft-discard');
    assert.equal(w.byTestId('deal-eadwyn-draft-text'), undefined);
    assert.equal(w.calls.filter((c) => c.method === 'POST' && c.url.includes('/deals/900/notes')).length, 0, 'no note');
    assert.equal(w.calls.filter((c) => c.url.includes('/api/fills/record')).length, 0, 'no record');
    const decide = w.calls.find((c) => c.url.includes('/proposals/p-7/decide'));
    assert.deepEqual(decide.body, { decision: 'discard' });
  } finally { await w.unmount(); }
});

test('a refusal says why and offers Try again; a run with no draft says so; a reader who may not fill draws no live button', async () => {
  const refused = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes({
    'POST /api/ai/rail/run': () => stream({ refusal: { code: 'spend_limit', message: 'You reached today’s AI limit.' }, proposals: [], dropped: [] }),
  }));
  try {
    await refused.press('deal-eadwyn-draft-ask');
    assert.match(refused.text(refused.byTestId('deal-eadwyn-draft-refused')), /today’s AI limit/);
    assert.equal(refused.text(refused.byTestId('deal-eadwyn-draft-ask')), 'Try again');
  } finally { await refused.unmount(); }
  const empty = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes({
    'POST /api/ai/rail/run': () => stream({ proposals: [], dropped: [], sources: SOURCES }),
  }));
  try {
    await empty.press('deal-eadwyn-draft-ask');
    assert.match(empty.text(empty.byTestId('deal-eadwyn-draft-empty')), /drafted no summary/);
    assert.ok(empty.byTestId('deal-eadwyn-draft-sources'));
  } finally { await empty.unmount(); }
  const reader = await mount(h(DealNotes, { dealId: 900, userId: 41 }), routes({ 'GET /api/fills/sheet': () => json(SHEET({ can_fill: false })) }));
  try {
    assert.equal(reader.props(reader.byTestId('deal-eadwyn-draft-ask')).disabled, true);
    await reader.press('deal-eadwyn-draft-ask');
    assert.equal(reader.calls.filter((c) => c.url.includes('/api/ai/rail/run')).length, 0);
  } finally { await reader.unmount(); }
});

test('a source state the page does not know reads Unreadable, never Used', () => {
  assert.deepEqual(draftSourceRows([{ key: 'x', label: 'X', state: 'weird' }]).map((r) => [r.state, r.word]), [['unreadable', 'Unreadable']]);
  assert.deepEqual(draftSourceRows(null), []);
});
