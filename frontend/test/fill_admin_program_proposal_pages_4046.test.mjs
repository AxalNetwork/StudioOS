// #4046 Group B4 — Ask on Admin · Programs' Propose a program, the pages half.
//   - the model: `SCOPED_FORMS.programProposal` is FILL_FIELDS' three fields on
//     program_proposals; the studio's other choices are said never to be filled;
//   - ProposePage, mounted against a stubbed fetch: a new proposal reads the sheet
//     under the caller (no record, no parent); Name and One-line purpose draw a
//     trigger, each label naming its input; Ask → Accept places the words; Save
//     starts the draft, then records the placed proposals against the id it
//     answers, before the page moves to the stored proposal;
//   - a stored proposal reads nothing while it loads, then reads by its id; a
//     sent one reads nothing;
//   - HQ's New program dialog draws the same fields with no Fill and no ids.
//
// Booleans, not nodes: a failing assert on a DOM node prints the whole fake tree and never ends.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_admin_program_proposal_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import ProposePage from '../src/pages/admin/programs/ProposePage.jsx';
import { BasicsFields, HowItRunsFields } from '../src/pages/admin/programs/ProposalFields.jsx';
import { emptyForm } from '../src/pages/admin/programs/proposalsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PP = SCOPED_FORMS.programProposal;
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.com' };
const STAMP = '2026-10-16T09:41:00.000Z';

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const proposal = (o = {}) => ({
  id: 742, uid: 'pp-new', status: 'draft', studio: 'Studio North', licence_uid: 'lic-n', name: null, purpose: null, who: null, group: null,
  join_method: null, cycle: null, cohort_weeks: null, seats: null, eligibility: null, rewards: null, template_keys: [], hq_receives: null,
  tools: null, sent_at: null, decision: null, hq_note: null, decided_at: null, program_key: null, created_at: STAMP, updated_at: STAMP, ...o,
});
const view = (f) => ({
  field: f, label: f, table: 'program_proposals', column: f, class: 'composition', sources: ['eadwyn'],
  value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [],
});
const SHEET = (extra = {}) => ({
  page: PP.page, form: PP.form, project: null, scope: 'owner:902', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }], fields: ['name', 'purpose', 'eligibility'].map(view),
  quote: { option: `form:${PP.form}`, state: 'ok', runs: 0, average_microusd: null }, ...extra,
});

/** `routes`: `METHOD /path` → handler(call); any other GET never answers, any other write throws. */
async function mounted(url, routes) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = String(u).split('?');
    const call = { url: String(u), path, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (path === '/api/auth/me') return response(ADMIN);
    const key = Object.keys(routes).find((k) => k === `${method} ${path}`);
    if (key) return routes[key](call);
    if (method === 'GET') return never();
    throw new Error(`unrouted ${method} ${path}`);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(ADMIN));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProposePage), h(Probe)))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    calls, at, flush,
    has: (id) => !!byId(id),
    value: (id) => props(byId(id)).value,
    textOf: (id) => text(byId(id)),
    labelFor: (forId) => walk(container).some((n) => n.tagName?.toLowerCase?.() === 'label' && props(n).htmlFor === forId),
    idOf: (id) => props(byId(id)).id,
    async press(id) { const p = props(byId(id)); assert.equal(typeof p.onClick, 'function', `no ${id} to press`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    sheets: () => calls.filter((c) => c.path === '/api/fills/sheet'),
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      localStorage.removeItem?.('user');
      restore();
    },
  };
}

test('the model: name, purpose and eligibility on program_proposals; the studio\'s other choices are never filled', () => {
  assert.deepEqual(PP, { page: 'Admin · Programs', form: 'program-proposal', table: 'program_proposals' });
  assert.deepEqual(fieldsOf(PP.page, PP.form).map((f) => [f.field, f.table, f.class]),
    ['name', 'purpose', 'eligibility'].map((c) => [c, 'program_proposals', 'composition']));
  assert.match(NOT_FILLED_HERE['program-proposal'][0], /^Who it is for, group, join method, cycle, seats, rewards, contract templates, what HQ receives and tools · they are yours to set\.$/);
});

test('a new proposal: the read names no record and no parent; Name and One-line purpose draw Ask, each label naming its input', async () => {
  // Mutation checked: `fill` not passed to BasicsFields → no field trigger; the label's htmlFor dropped → labelFor is false.
  const w = await mounted('/admin/programs/propose', { 'GET /api/fills/sheet': () => response(SHEET()) });
  try {
    const sheets = w.sheets();
    assert.equal(sheets.length, 1);
    assert.match(sheets[0].url, /form=program-proposal/);
    assert.doesNotMatch(sheets[0].url, /record=|parent=|project=/, 'a new proposal hangs under the caller, named by the Worker');
    assert.equal(w.has('fill-trigger-name'), true);
    assert.equal(w.has('fill-trigger-purpose'), true);
    assert.equal(w.has('fill-form-trigger'), true, 'the form\'s Ask');
    assert.match(w.textOf('fill-scoped-not-here'), /they are yours to set/);
    assert.equal(w.idOf('propose-name'), 'propose-name');
    assert.equal(w.labelFor('propose-name'), true, 'the Name label names its input');
    assert.equal(w.labelFor('propose-purpose'), true);
    await w.change('propose-name', 'Typed by me');
    assert.equal(w.has('fill-trigger-name'), false, 'a typed name draws no trigger');
    await w.press('propose-step-1');
    assert.equal(w.has('fill-trigger-eligibility'), true, 'Eligibility on How it runs');
    assert.equal(w.labelFor('propose-eligibility'), true);
    await w.press('propose-step-2');
    assert.equal(w.has('fill-scoped-bar'), false, 'Terms has no Ask');
  } finally { await w.close(); }
});

test('Ask → Accept → Save: the draft is started with the words, then the placed proposals are recorded on the id it answers', async () => {
  // Mutations checked: `fill.afterSave` dropped from save() → no record call; the stored id not passed → no record call;
  // (afterSave moved after navigate is caught by the wiring test at the end.)
  const sse = `event: done\ndata: ${JSON.stringify({ proposals: [
    { uid: 'p-1', field: 'name', value: 'Porto design residency' }, { uid: 'p-2', field: 'purpose', value: 'Two weeks of design reviews.' },
    { uid: 'p-3', field: 'eligibility', value: 'Studios with a live venture.' },
  ], dropped: [], charged_microusd: 1200 })}\n\n`;
  let navigatedBeforeRecord = null;
  const w = await mounted('/admin/programs/propose', {
    'GET /api/fills/sheet': () => response(SHEET()),
    'POST /api/ai/rail/run': () => ({ ok: true, status: 200, headers: new Map(), text: async () => sse, json: async () => ({}) }),
    'POST /api/admin/programs/proposals': (c) => response({ proposal: proposal({ ...c.body }) }, 201),
    'POST /api/fills/record': () => { navigatedBeforeRecord = w.at.path.includes('proposal='); return response({ record: 'program_proposals:742', outcomes: [] }); },
  });
  try {
    await w.press('fill-form-trigger');
    await w.press('fill-sheet-preview');
    const run = w.calls.find((c) => c.path === '/api/ai/rail/run');
    assert.deepEqual([run.body.option, run.body.page, run.body.record ?? null, run.body.parent ?? null, run.body.project ?? null],
      [`form:${PP.form}`, PP.page, null, null, null], 'the run names no venture, record or parent');
    await w.press('fill-sheet-accept-all');
    assert.equal(w.value('propose-name'), 'Porto design residency');
    assert.equal(w.value('propose-purpose'), 'Two weeks of design reviews.');
    await w.change('propose-purpose', 'Two weeks of design reviews, weekly.');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false, 'nothing is recorded before Save');
    await w.press('propose-save');
    const started = w.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/programs/proposals');
    assert.equal(started.body.name, 'Porto design residency');
    assert.equal(started.body.purpose, 'Two weeks of design reviews, weekly.');
    assert.equal(started.body.eligibility, 'Studios with a live venture.');
    const rec = w.calls.find((c) => c.path === '/api/fills/record');
    assert.equal(!!rec, true, 'Save records the placed proposals');
    // Every placed proposal is named; the Worker re-reads the row and lets the typed-over purpose go (`not_kept`).
    assert.deepEqual(rec.body, { page: PP.page, form: PP.form, record: 742, proposals: ['p-1', 'p-2', 'p-3'] });
    assert.equal(navigatedBeforeRecord, false, 'recorded before the page moves to the stored proposal');
    assert.equal(w.at.path, '/admin/programs/propose?proposal=pp-new');
    assert.equal(w.sheets().at(-1).url.includes('record=742'), true, 'the read is taken again, by the stored id');
  } finally { await w.close(); }
});

test('a stored proposal: no read while it loads, then by its id; a sent one reads nothing', async () => {
  // Mutation checked: `enabled` without the read state → the loading page reads the sheet as a new proposal.
  const loading = await mounted('/admin/programs/propose?proposal=pp-a', { 'GET /api/fills/sheet': () => response(SHEET()) });
  try {
    assert.equal(loading.has('propose-loading'), true);
    assert.equal(loading.sheets().length, 0, 'the empty form is never read as a new draft');
  } finally { await loading.close(); }
  const stored = await mounted('/admin/programs/propose?proposal=pp-a', {
    'GET /api/admin/programs/proposals/pp-a': () => response({ proposal: proposal({ id: 77, uid: 'pp-a', name: 'Operator Fellowship' }) }),
    'GET /api/fills/sheet': () => response(SHEET({ record: 'program_proposals:77' })),
  });
  try {
    assert.equal(stored.sheets().length, 1);
    assert.match(stored.sheets()[0].url, /record=77/);
    assert.equal(stored.has('fill-trigger-name'), false, 'a named proposal draws no Name trigger');
    assert.equal(stored.has('fill-trigger-purpose'), true);
  } finally { await stored.close(); }
  const sent = await mounted('/admin/programs/propose?proposal=pp-s', {
    'GET /api/admin/programs/proposals/pp-s': () => response({ proposal: proposal({ id: 78, uid: 'pp-s', status: 'sent', name: 'Sent one' }) }),
    'GET /api/fills/sheet': () => response(SHEET()),
  });
  try {
    assert.equal(sent.has('propose-readonly'), true);
    assert.equal(sent.sheets().length, 0, 'a sent proposal is HQ\'s to read');
  } finally { await sent.close(); }
});

test('HQ\'s New program dialog draws the same fields with no Fill: no ids, no htmlFor, no Fill label', () => {
  const html = renderToStaticMarkup(h('div', null,
    h(BasicsFields, { form: emptyForm(), set() {}, prefix: 'programs-new' }), h(HowItRunsFields, { form: emptyForm(), set() {}, prefix: 'programs-new' })));
  assert.doesNotMatch(html, / id="programs-new-| for="/);
  assert.doesNotMatch(html, /fill-/);
  assert.match(html, /<label class="flex flex-col gap-1"><span class="[^"]+">Name<\/span><input/, 'Field, as before');
  assert.doesNotMatch(read('pages/admin/programs/NewProgramDialog.jsx'), /fill=/);
});

test('the wiring: the record step sits between the Save\'s answer and the move to the stored proposal', () => {
  const page = read('pages/admin/programs/ProposePage.jsx');
  assert.match(page, /setProposal\(stored\);\n(\s*\/\/[^\n]*\n)?\s*if \(stored\?\.id\) await fill\.afterSave\(stored\.id\);\n\s*if \(!proposal\?\.uid && stored\?\.uid\) navigate/);
  assert.match(page, /enabled: \(read\.state === 'new' \|\| read\.state === 'ready'\) && \(!proposal \|\| isEditable\(proposal\.status\)\)/);
});
