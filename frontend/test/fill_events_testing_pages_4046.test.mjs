// #4046 Group B2 — Ask on /events/new and on a member's answers to a
// product-testing programme, the pages half.
//   - the model: `SCOPED_FORMS.testingAnswers` is FILL_FIELDS' five answers on
//     testing_applications; availability and consent are said never to be filled;
//   - ProgrammeSheet, mounted against a stubbed fetch: the read names the
//     programme as the parent; only the programme's own questions draw a
//     trigger (`only`), so answering both leaves no form Ask; Accept places the
//     answers; Apply posts them, then records the placed proposals against the
//     new application's id;
//   - EventEditorPage: the hook is on for /events/new, the Title has its label
//     and trigger, and the create records against the new event's id.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_events_testing_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import { ProgrammeSheet } from '../src/pages/testing/member/TesterSheets.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

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
  const store = new Map();
  const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
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
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const type = async (id, value) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); };
  const press = async (id) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); };
  await flush();
  return {
    calls, byTestId, props, flush, type, press,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = realFetch; globalThis.localStorage = realStorage; restoreDoc(); },
  };
}
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });

const view = (f) => ({
  field: f, label: f, table: 'testing_applications', column: f, class: 'composition', sources: ['eadwyn'],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [],
});
// The read lists all five answers, as the Worker does; the programme draws two.
const SHEET = {
  page: SCOPED_FORMS.testingAnswers.page, form: 'testing-answers', project: null, scope: 'programme:700', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }], fields: [1, 2, 3, 4, 5].map((n) => view(`answer_${n}`)),
  quote: { option: 'form:testing-answers', state: 'ok', runs: 0, average_microusd: null },
};
const PROGRAMME = { id: 700, uid: 'pg-open', product_name: 'Ledgerly', owner_name: 'Axal VC', places: 5, picked_count: 0, questions: ['What do you use today?', 'What would make you switch?'], my_status: null };

test('the model: five answers on testing_applications; availability and consent are never filled', () => {
  const fields = fieldsOf(SCOPED_FORMS.testingAnswers.page, SCOPED_FORMS.testingAnswers.form);
  assert.deepEqual(fields.map((f) => [f.field, f.table]), [1, 2, 3, 4, 5].map((n) => [`answer_${n}`, 'testing_applications']));
  assert.match(NOT_FILLED_HERE['testing-answers'][0], /^Availability and email consent/);
  assert.deepEqual(fieldsOf(SCOPED_FORMS.event.page, 'event').map((f) => f.field), ['title', 'description']);
});

test('ProgrammeSheet: the read names the programme; only its two questions draw a trigger; answering both leaves no Ask', async () => {
  // Booleans, not nodes: a failing assert on a DOM node prints the whole fake tree and never ends.
  // Mutation checked: `only` dropped from the mount → answers 3 to 5 count as blank and the form's Ask stays after both are typed.
  const api = { apply: async () => ({ application: { id: 812, uid: 'ap-1' } }) };
  const w = await mount(h(ProgrammeSheet, { programme: PROGRAMME, consent: null, api, onClose() {} }), { routes: { '/api/fills/sheet': () => json(SHEET) } });
  try {
    const read = w.calls.find((c) => c.url.includes('/api/fills/sheet'));
    assert.match(read.url, /parent=700/);
    assert.match(read.url, /form=testing-answers/);
    assert.ok(w.byTestId('fill-trigger-answer_1'));
    assert.ok(w.byTestId('fill-trigger-answer_2'));
    assert.equal(!!w.byTestId('fill-trigger-answer_3'), false, 'a question the programme does not ask');
    assert.ok(w.byTestId('fill-form-trigger'));
    await w.type('pt-programme-answer-0', 'A spreadsheet');
    await w.type('pt-programme-answer-1', 'Bank sync');
    assert.equal(!!w.byTestId('fill-form-trigger'), false, 'every answer the programme asks is given');
  } finally { await w.unmount(); }
});

test('ProgrammeSheet: Apply sends the member\'s own answers; with nothing placed it records nothing, and the read is taken again', async () => {
  const applied = [];
  const api = { apply: async (uid, body) => { applied.push([uid, body]); return { application: { id: 812, uid: 'ap-1' } }; } };
  const w = await mount(h(ProgrammeSheet, { programme: PROGRAMME, consent: null, api, onClose() {}, onApplied() {} }),
    { routes: { '/api/fills/sheet': () => json(SHEET), '/api/fills/record': () => json({ outcomes: [] }) } });
  try {
    await w.type('pt-programme-answer-0', 'A spreadsheet');
    await w.type('pt-programme-answer-1', 'Bank sync');
    const reads = w.calls.filter((c) => c.url.includes('/api/fills/sheet')).length;
    await w.press('pt-programme-apply');
    assert.deepEqual(applied.map(([uid, b]) => [uid, b.answers]), [['pg-open', ['A spreadsheet', 'Bank sync']]]);
    assert.equal(w.calls.filter((c) => c.url.includes('/api/fills/record')).length, 0, 'typed answers are the member\'s: nothing to record');
    assert.ok(w.calls.filter((c) => c.url.includes('/api/fills/sheet')).length > reads, 'afterSave ran: the read is taken again');
  } finally { await w.unmount(); }
});

test('the wiring: Apply records after the application is made; /events/new mounts the event form with its Title', () => {
  const sheets = read('pages/testing/member/TesterSheets.jsx');
  assert.match(sheets, /scope: SCOPED_FORMS\.testingAnswers, parent: Number\(p\?\.id\) > 0 \? Number\(p\.id\) : null/);
  assert.match(sheets, /only: Object\.keys\(values\)/);
  assert.match(sheets, /const r = await api\.apply\(p\.uid, body\);\n\s+\/\/[^\n]*\n\s+await fill\.afterSave\(r\?\.application\?\.id\);/, 'the record step runs after Apply, on the new application');
  const editor = read('pages/events/EventEditorPage.jsx');
  assert.doesNotMatch(editor, /enabled: isEdit/, 'the hook is on for /events/new');
  assert.match(editor, /<FillLabel fill=\{fill\} name="title" label="Title" value=\{form\.title\}>/);
  assert.equal((editor.match(/await fill\.afterSave\(newId\);/g) || []).length, 2, 'Save and Publish each record against the new event');
});
