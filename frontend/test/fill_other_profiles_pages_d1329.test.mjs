// D1329 (#3490, part 6 of #2431): Fill with Eadwyn on every other profile's
// forms, the pages half (AF15, AF17–AF22).
//   - the model (`lib/fillScoped.js`): each board's form is FILL_FIELDS', its
//     "Not filled here" words, the off lines;
//   - the hook (`ui/useScopedFill.jsx`), mounted against a stubbed fetch: the
//     read names the record or the parent and never a venture; a writer gets
//     the trigger and "Fill" while a field is blank; a placed value is "Not
//     saved" and nothing is written until Save; Save's record step sends the
//     saved row and the placed proposal, never a venture; a reader reads the
//     marks with no trigger and no Undo (AF15); a support session says "Fill is
//     off in a support session." (AF15); an Explorer says "Fill opens once you
//     hold a venture or a profile." (AF22); an unreadable read says so, with
//     Try again;
//   - the wiring on each page: Services (AF18), Reporting (AF19), the IC memo
//     (AF17), the event and its agenda (AF20), the publication with H20's
//     draft (AF21), the founder form's support line (AF15), the Explorer's
//     profile (AF22).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_other_profiles_pages_d1329.test.mjs
import test from 'node:test';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import { clearRailPage, setRailPage } from '../src/lib/railPage.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { EXPLORER_OFF, NOT_FILLED_HERE, SCOPED_FORMS, SUPPORT_OFF, fillOffLine } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import { FillFormBar, FillLabel, useScopedFill } from '../src/ui/useScopedFill.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// ── The model ───────────────────────────────────────────────────────────────

test('each board\'s form is one FILL_FIELDS lists, on its table; the off lines and what is never filled here', () => {
  for (const [k, s] of Object.entries(SCOPED_FORMS)) {
    const fields = fieldsOf(s.page, s.form);
    assert.ok(fields.length, k);
    assert.ok(fields.every((f) => f.table === s.table), `${k} writes ${s.table}`);
  }
  assert.equal(fillOffLine({ support: true }), 'Ask is off in a support session.');
  assert.equal(fillOffLine({ explorer: true }), 'Ask opens once you hold a venture or a profile.');
  assert.equal(fillOffLine({ explorer: true, support: true }), EXPLORER_OFF);
  assert.equal(fillOffLine({}), null, 'a reader needs no line: the marks are the record\'s');
  assert.match(NOT_FILLED_HERE['ic-memo'][0], /^Commitment amount/);
  assert.match(NOT_FILLED_HERE.service[0], /^Price/);
  assert.match(NOT_FILLED_HERE.publication[0], /^Author/);
  assert.deepEqual(NOT_FILLED_HERE['status-report'], undefined, 'every field of a report can be filled (AF19)');
});

// ── The hook, mounted ───────────────────────────────────────────────────────

async function mount(element, { routes = {}, support = false } = {}) {
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
  const store = new Map(support ? [['supportSession', JSON.stringify({ operator: 'hq', expires_at: new Date(Date.now() + 3600000).toISOString(), expiresAt: Date.now() + 3600000 })]] : []);
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
  const all = () => walk(container);
  const byTestId = (id) => all().find((n) => props(n)['data-testid'] === id);
  const text = (n = container) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const press = async (id) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); };
  const type = async (id, value) => { const n = byTestId(id); assert.ok(n, `missing ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await flush(); };
  await flush();
  return {
    calls, byTestId, text, flush, press, type, props, all,
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = realFetch; globalThis.localStorage = realStorage; restoreDoc(); },
  };
}
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });

let fill = null;
/** A report's two fields, as Reporting draws them, on the one hook. */
function Report({ record = null, parent = null, initial = {} }) {
  const [values, setValues] = React.useState({ shipped: '', next_up: '', ...initial });
  fill = useScopedFill({ scope: SCOPED_FORMS.statusReport, record, parent, values, onValues: (v) => setValues((o) => ({ ...o, ...v })) });
  return h('div', null,
    h(FillFormBar, { fill }),
    ...['shipped', 'next_up'].map((name) => h('div', { key: name },
      h(FillLabel, { fill, name, label: name, value: values[name] }, h('span', null, name)),
      h('input', { 'data-testid': `in-${name}`, value: values[name], onChange: (e) => setValues((o) => ({ ...o, [name]: e.target.value })) }))));
}

const view = (f, extra = {}) => ({
  field: f, label: f, table: 'engagement_status_reports', column: f, class: 'composition', sources: ['eadwyn'],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [], ...extra,
});
const SHEET = (extra = {}) => ({
  page: SCOPED_FORMS.statusReport.page, form: 'status-report', project: null, scope: 'engagement:401', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }], fields: [view('shipped'), view('next_up')],
  quote: { option: 'form:status-report', state: 'ok', runs: 0, average_microusd: null }, ...extra,
});

test('a writer: the read names the parent, never a venture; a trigger while blank; placed is "Not saved"; Save records the row and the proposal', async () => {
  const w = await mount(h(Report, { parent: 401 }), { routes: { '/api/fills/sheet': () => json(SHEET()), '/api/fills/record': () => json({ outcomes: [] }) } });
  try {
    const sheetCall = w.calls.find((c) => c.url.includes('/api/fills/sheet'));
    assert.match(sheetCall.url, /parent=401/);
    assert.doesNotMatch(sheetCall.url, /project=/, 'a record that is not a venture\'s names no venture');
    assert.ok(w.byTestId('fill-trigger-shipped'));
    assert.ok(w.byTestId('fill-form-trigger'), 'the form\'s "Fill" while a field is blank');
    assert.equal(w.props(w.byTestId('fill-form-trigger'))['aria-label'], 'Ask Eadwyn');
    await act(async () => { fill.place([{ field: 'shipped', value: 'Pricing deck v2', source_kind: 'eadwyn', proposal_uid: 'p-1' }, { field: 'price_cents', value: '500', proposal_uid: 'p-2' }]); });
    await w.flush();
    assert.equal(w.byTestId('in-shipped').value, 'Pricing deck v2');
    assert.equal(w.byTestId('fill-trigger-shipped'), undefined, 'a placed value has no trigger');
    assert.match(w.text(w.byTestId('fill-label-shipped')), /Not saved/, 'a placed value reads "Not saved"');
    assert.equal(w.calls.filter((c) => c.url.includes('/api/fills/record')).length, 0, 'nothing is written before Save');
    await act(async () => { await fill.afterSave(902); });
    await w.flush();
    const rec = w.calls.find((c) => c.url.includes('/api/fills/record'));
    assert.deepEqual(rec.body, { page: SCOPED_FORMS.statusReport.page, form: 'status-report', record: 902, proposals: ['p-1'] });
  } finally { await w.unmount(); }
});

test('a Save with nothing placed records nothing; a typed value keeps no "Not saved" mark', async () => {
  const w = await mount(h(Report, { record: 411 }), { routes: { '/api/fills/sheet': () => json(SHEET({ record: 'engagement_status_reports:411' })), '/api/fills/record': () => json({ outcomes: [] }) } });
  try {
    assert.match(w.calls[0].url, /record=411/);
    await act(async () => { fill.place([{ field: 'next_up', value: 'Pilot pricing call', proposal_uid: null, source_kind: 'module' }]); });
    await w.flush();
    await w.type('in-next_up', 'Pilot pricing call, moved');
    assert.equal(w.byTestId('fill-label-next_up'), undefined, 'typed over: no mark and no trigger');
    await act(async () => { await fill.afterSave(411); });
    assert.equal(w.calls.filter((c) => c.url.includes('/api/fills/record')).length, 0, 'a value from the engagement record is no Eadwyn proposal');
  } finally { await w.unmount(); }
});

test('AF15: a reader reads the marks with no trigger and no Undo; a support session says Fill is off', async () => {
  const mark = { provenance_id: 7, source_kind: 'eadwyn', model: null, decided_at: '2026-10-27T10:00:00Z' };
  // `next_up` carries a trigger the read should not have sent: the page's own lock (`can_fill`) still draws none.
  const reader = SHEET({ can_fill: false, fields: [view('shipped', { trigger: false, mark, value: 'Sent text' }), view('next_up', { trigger: true })] });
  let w = await mount(h(Report, { record: 412, initial: { shipped: 'Sent text' } }), { routes: { '/api/fills/sheet': () => json(reader) } });
  try {
    assert.ok(w.byTestId('fill-mark'), 'the reader reads the mark');
    assert.equal(w.byTestId('fill-trigger-next_up'), undefined);
    assert.equal(w.byTestId('fill-form-trigger'), undefined);
    assert.equal(w.byTestId('fill-scoped-off'), undefined, 'a reader needs no line');
    await w.press('fill-mark');
    assert.equal(w.byTestId('fill-mark-undo'), undefined, 'no Undo for a reader');
  } finally { await w.unmount(); }
  w = await mount(h(Report, { record: 412 }), { routes: { '/api/fills/sheet': () => json(reader) }, support: true });
  try { assert.equal(w.text(w.byTestId('fill-scoped-off')), SUPPORT_OFF); } finally { await w.unmount(); }
});

test('AF22: an Explorer is told what opens Fill; a refused record shows nothing; an unreadable read says so with Try again', async () => {
  let w = await mount(h(Report, { parent: 401 }), { routes: { '/api/fills/sheet': () => json({ error: 'no_profile', detail: EXPLORER_OFF }, 403) } });
  try { assert.equal(w.text(w.byTestId('fill-scoped-off')), EXPLORER_OFF); } finally { await w.unmount(); }
  w = await mount(h(Report, { parent: 401 }), { routes: { '/api/fills/sheet': () => json({ error: 'record_not_available' }, 403) } });
  try { assert.equal(w.byTestId('fill-scoped-bar'), undefined); assert.equal(w.byTestId('fill-scoped-unreadable'), undefined); } finally { await w.unmount(); }
  let n = 0;
  w = await mount(h(Report, { parent: 401 }), { routes: { '/api/fills/sheet': () => { n += 1; return n === 1 ? json({ detail: 'boom' }, 500) : json(SHEET()); } } });
  try {
    assert.match(w.text(w.byTestId('fill-scoped-unreadable')), /could not be read/);
    const retry = w.byTestId('fill-scoped-unreadable').childNodes.find((c) => c.tagName === 'BUTTON' || c.nodeName === 'BUTTON');
    await act(async () => { Object.entries(retry).find(([k]) => k.startsWith('__reactProps$'))[1].onClick(); });
    await w.flush();
    assert.ok(w.byTestId('fill-trigger-shipped'), 'Try again reads again');
  } finally { await w.unmount(); }
});

// ── The wiring ──────────────────────────────────────────────────────────────

test('each page mounts the one hook on its own form, and records after its own Save', () => {
  const wiring = [
    ['pages/advisor/expertise/ServicesZone.jsx', 'service', /await fill\.afterSave\(created\?\.id\);/],
    ['pages/partner/delivery/StatusReportsZone.jsx', 'statusReport', /await fill\.afterSave\(saved\?\.id\);/],
    ['pages/ICDecisionPage.jsx', 'icMemo', /await api\.icUpdate\(uid, \{ memo \}\); await fill\.afterSave\(d\?\.id\);/],
    ['pages/events/EventEditorPage.jsx', 'event', /await fill\.afterSave\(Number\(id\)\);/],
    ['pages/events/EventManagePage.jsx', 'agendaItem', /await agendaFill\.afterSave\(made\?\.item\?\.id\);/],
    ['pages/admin/PublicationDetail.jsx', 'publication', /await fill\.afterSave\(fromProposal \? null : pubId\);/],
  ];
  for (const [file, key, save] of wiring) {
    const src = read(file);
    assert.match(src, new RegExp(`scope: SCOPED_FORMS\\.${key}`), `${file} fills ${key}`);
    assert.match(src, save, `${file} records after its Save`);
    assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/, file);
  }
  // AF19: a new report hangs under its engagement for this month only; a saved one is its own record.
  assert.match(read('pages/partner/delivery/StatusReportsZone.jsx'), /parent: reportId \? null : \(engagementId && draft\.period === thisMonth \? Number\(engagementId\) : null\)/);
  // AF20: an event is edited, never added, here; its agenda's new item hangs under the event.
  assert.match(read('pages/events/EventEditorPage.jsx'), /record: isEdit \? Number\(id\) : null, enabled: isEdit/);
  // AF21: H20's draft, placed from the sheet, is still kept by the publication's own Save.
  const pub = read('pages/admin/PublicationDetail.jsx');
  assert.match(pub, /\.\.\.\(fromProposal \? \{ summary_proposal_uid: fromProposal \} : \{\}\)/);
  assert.doesNotMatch(pub, /Put it in the summary/, 'the draft moved into the shared sheet');
  // AF15: the founder's form says a support session turns Fill off.
  assert.match(read('pages/cycles/FormLightbox.jsx'), /fillRead\.data\?\.can_fill === false && activeSupportSession\(\)[\s\S]{0,400}\{SUPPORT_OFF\}/);
  // AF22: the Explorer's profile.
  assert.match(read('pages/account/AccountProfile.jsx'), /explorer \? \([\s\S]{0,400}\{EXPLORER_OFF\} <Link to="\/exploring"/);
  // The sheet names the record or its parent, and a venture only when there is one.
  const sheet = read('ui/FillSheet.jsx');
  assert.match(sheet, /\.\.\.\(project != null \? \{ project \} : \{\}\),/);
  assert.match(sheet, /: parent != null \? \{ parent \} : \{\}\),/);
  assert.match(read('lib/api/fills.js'), /\$\{project != null \? `&project=\$\{enc\(project\)\}` : ''\}/);
});

test('scoped Ask follows the mounted rail switch, including its neutral field mark and sources-only sheet', async () => {
  for (const workspace of ['Delivery', null]) {
    __resetAssistModeForTest();
    const token = setRailPage(workspace || '');
    const key = workspace || SCOPED_FORMS.statusReport.page;
    seedAssistModes({ [key]: false });
    const w = await mount(h(Report, { parent: 401 }), { routes: { '/api/fills/sheet': () => json(SHEET()) } });
    const walk = (n) => n ? [n, ...(n.childNodes || []).flatMap(walk)] : [];
    const neutral = (n) => walk(n).some((el) => w.props(el).stroke === 'currentColor');
    const facts = () => ({
      text: w.text(w.byTestId('fill-form-trigger')),
      name: w.props(w.byTestId('fill-form-trigger'))['aria-label'],
      field: w.props(w.byTestId('fill-trigger-shipped'))['aria-label'],
      formNeutral: neutral(w.byTestId('fill-form-trigger')), fieldNeutral: neutral(w.byTestId('fill-trigger-shipped')),
    });
    const source = () => w.all().find((n) => w.props(n)['aria-label'] === 'Use Eadwyn');
    try {
      assert.deepEqual(facts(), { text: 'Ask', name: 'Ask (from your sources)', field: 'Ask to fill shipped from your sources', formNeutral: true, fieldNeutral: true });
      await w.press('fill-form-trigger');
      assert.deepEqual({ message: w.text(w.byTestId('fill-source-average')), disabled: w.props(source()).disabled },
        { message: 'AI assistance is off on this page.', disabled: true });
      await act(async () => { seedAssistModes({ [key]: true }); });
      await w.flush();
      assert.deepEqual(facts(), { text: 'Ask', name: 'Ask Eadwyn', field: 'Ask Eadwyn to fill shipped', formNeutral: false, fieldNeutral: false });
      assert.equal(w.props(source()).disabled, false);
    } finally { await w.unmount(); clearRailPage(token); __resetAssistModeForTest(); }
  }
});
