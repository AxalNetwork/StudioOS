// D1192 (#3126) — Capital relationships part 4: Overview's blocks (CRL1), the
// Pipeline board and list (CRL2, CRL3), the investor lightbox (CRL4), Add
// investor and Import (CRL5), the move, status, next step, step and feedback
// dialogs (CRL6), and the states (CRL13–CRL15). Moving to Committed asks for
// the status; an import reports skipped rows; the board writes through the one
// writer.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/caprel_pipeline_d1192.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  IMPORT_CHUNK, MOVED, NO_STATUS, asksStatus, boardColumns, chunks, importRows, mergeImport, moveBody, moveSentence, moveTargets,
  needsYou, overviewFigures, statusCounts, statusLabel,
} from '../src/pages/raise/caprel/capRelModel.js';
import { parseCsv } from '../src/pages/RaisePipelinePage.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const TODAY = '2026-10-26';

const P = (id, name, stage, o = {}) => ({ id, name, stage, updated_at: `2026-10-${String(10 + id % 10).padStart(2, '0')}`, ...o });
const PROSPECTS = [
  P(41, 'Bluefern Capital', 'meeting', { next_step: 'Send the deck', next_step_due: '2026-10-20' }),
  P(42, 'Northwind Ventures', 'to_contact'),
  P(43, 'Kite Angels', 'committed', { commit_status: 'wired', amount: 50000 }),
  P(44, 'Harbour Fund', 'committed', { amount: null }),
  P(45, 'Osprey Partners', 'passed'),
  P(46, 'Juno Capital', 'diligence', { next_step: 'Data room', next_step_due: TODAY }),
  P(47, 'Alder Seed', 'contacted'),
];
const PROJECTS = [{ id: 3, uid: 'p3uid', name: 'Harbor Ledger' }];
const MODULE = {
  module: { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
  card: { state: 'empty', reason: 'No investors yet.' },
  records: { linkable: true, total: 0, page: 1, page_size: 25, cols: [{ key: 'investor', label: 'Investor' }], rows: [] },
  parts: { calls: { state: 'ok', items: [] } },
};
const COMMITMENTS = {
  currency: 'USD', round: { name: 'Seed', target_cents: 200000000, currency: 'USD' }, round_reason: null,
  totals: { counted_cents: 5000000, not_counted_cents: 0, percent_of_target: 2.5, partial: false },
};
const RECORD = { facts: [{ label: 'Stage', value: 'Meeting' }], main: [{ key: 'timeline', title: 'Timeline', rows: [{ a: 'Meeting', b: '2026-10-12', c: 'Done' }] }], side: [] };

function handlerOf(o = {}) {
  return (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (/\/api\/projects(\?|$)/.test(url)) return response(PROJECTS);
    if (/\/contacts\/raise-prospects\?/.test(url)) return o.prospects === null ? response({ detail: 'down' }, 503) : response({ items: o.prospects ?? PROSPECTS });
    if (/capital-relationships\/commitments/.test(url)) return o.commitments === null ? response({ detail: 'down' }, 503) : response(o.commitments ?? COMMITMENTS);
    if (/\/records\/\d+\?/.test(url) && method === 'GET') return response(RECORD);
    if (/\/cycles\/raise\/prospects\/import/.test(url)) return response(o.importAnswer ?? { created: 1, total: 3, skipped: [{ row: 2, reason: 'A name or a valid email is required' }, { row: 3, reason: 'Already in the pipeline' }] });
    if (/\/cycles\/raise\/prospects\?/.test(url) && method === 'POST') return o.addStatus ? response({ detail: 'This project already tracks a prospect with that email' }, o.addStatus) : response({ id: 99 }, 201);
    if (/\/cycles\/raise\/prospects\/\d+/.test(url)) return response({ ok: true });
    if (/\/records\/\d+\/actions\//.test(url) || /\/actions\//.test(url)) return response({ ok: true });
    if (/\/contacts\/raise-closes/.test(url)) return response({ closes: [], round: null });
    if (/\/contacts\/raise-pro-rata/.test(url)) return response({ items: [] });
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, { phone = false, ...o } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const handle = handlerOf(o);
  globalThis.fetch = async (u, options = {}) => { calls.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    calls, flush, by,
    has: (id) => Boolean(by(id)),
    text: (id) => text(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    writes: () => calls.filter((c) => c.method !== 'GET'),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => props(n).onClick?.({ preventDefault() {}, stopPropagation() {} })); await flush(); },
    async change(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => props(n).onChange?.({ target: { value, files: null } })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the board: five stages in order with Passed apart, the newest change first; every card can move to any other stage', () => {
  const b = boardColumns(PROSPECTS);
  assert.deepEqual(b.columns.map((c) => [c.label, c.items.map((p) => p.id)]), [
    ['Identified', [42]], ['Contacted', [47]], ['Meeting', [41]], ['Diligence', [46]], ['Committed', [44, 43]],
  ]);
  assert.deepEqual(b.passed.map((p) => p.id), [45]);
  assert.deepEqual(moveTargets('meeting'), ['to_contact', 'contacted', 'diligence', 'committed', 'passed']);
  assert.deepEqual(boardColumns([{ id: 1, stage: 'hot' }]).unknown.map((p) => p.id), [1], 'an unknown stage is never dropped');
});

test('moving to Committed asks for the status, and the body carries it; no status is stored as not recorded and never counts', () => {
  // Mutation checked: asksStatus true for every move → the dialog asks on Diligence; moveBody dropping commit_status → Signed lost.
  assert.equal(asksStatus('meeting', 'committed'), true);
  assert.equal(asksStatus('committed', 'committed'), false);
  assert.equal(asksStatus('meeting', 'diligence'), false);
  assert.deepEqual(moveBody('committed', 'signed'), { stage: 'committed', commit_status: 'signed' });
  assert.deepEqual(moveBody('committed', ''), { stage: 'committed', commit_status: null });
  assert.deepEqual(moveBody('committed', 'promised'), { stage: 'committed', commit_status: null }, 'an unknown status is never sent');
  assert.deepEqual(moveBody('diligence', 'signed'), { stage: 'diligence' }, 'no status off Committed');
  assert.equal(statusLabel(null), NO_STATUS);
  assert.deepEqual(['soft', 'signed', 'wired', null].map(statusCounts), [false, true, true, false]);
  assert.equal(moveSentence(['Kite Angels'], 'meeting', 'committed'), 'Kite Angels will move from Meeting to Committed.');
  assert.equal(moveSentence(['a', 'b'], null, 'passed'), '2 investors will move to Passed. Their history stays on the record.');
});

test('Overview: by stage, follow-ups in due order with the overdue marked, and what needs you', () => {
  // Mutation checked: the overdue comparison `<` → `<=` makes today's follow-up overdue; a committed card with no status not counted in Needs you.
  const f = overviewFigures(PROSPECTS, TODAY);
  assert.deepEqual(f.byStage.map((s) => [s.label, s.n]), [['Identified', 1], ['Contacted', 1], ['Meeting', 1], ['Diligence', 1], ['Committed', 2], ['Passed', 1]]);
  assert.deepEqual(f.followUps.map((x) => [x.id, x.due, x.overdue]), [[41, '2026-10-20', true], [46, TODAY, false]]);
  assert.deepEqual([f.overdue, f.dueToday, f.noNextStep, f.committedNoStatus, f.inConversation], [1, 1, 1, 1, 3]);
  assert.deepEqual(needsYou(f).map((x) => x.text), [
    '1 follow-up is overdue', '1 follow-up is due today', '1 investor in conversation has no next step',
    '1 committed investor has no status, so it is not counted',
  ]);
  assert.deepEqual(needsYou(overviewFigures([], TODAY)), []);
});

test('Import: every data row is kept for the writer to judge, the columns are mapped, and a big file goes 50 rows a request', () => {
  // Mutation checked: dropping rows with no name or email → the writer never reports them; the chunk offset dropped → wrong row numbers.
  const parsed = importRows(parseCsv('Investor,Email,Fund,Check size,Stage,Owner\nKite,kite@x.test,Kite Fund,"$25,000",Meeting,me\n,,,,,\n,,Lone Fund,,,\nJuno,,,,,\n'));
  assert.deepEqual(parsed.rows.map((r) => r.name || r.firm), ['Kite', 'Lone Fund', 'Juno'], 'parseCsv drops a line with every field blank; a row with no name or email is kept, so the writer reports it');
  assert.deepEqual(parsed.rows[0], { name: 'Kite', email: 'kite@x.test', firm: 'Kite Fund', notes: '', stage: 'Meeting', amount: 25000 });
  assert.deepEqual(parsed.mapped.map((m) => m.field), ['name', 'email', 'firm', 'amount', 'stage']);
  assert.deepEqual(parsed.ignored, ['Owner']);
  assert.equal(importRows(parseCsv('Owner,Size\na,b\n')).error, 'The header row needs a name or an email column');
  const rows = importRows(parseCsv(`name\n${Array.from({ length: 51 }, (_, i) => `F${i}`).join('\n')}\n`)).rows;
  assert.deepEqual(chunks(rows).map((c) => c.length), [IMPORT_CHUNK, 1]);
  assert.deepEqual(mergeImport([{ created: 49, total: 50, skipped: [{ row: 7, reason: 'Already in the pipeline' }] }, { created: 0, total: 1, skipped: [{ row: 1, reason: 'A name or a valid email is required' }] }]), {
    created: 49, total: 51, skipped: [{ row: 7, reason: 'Already in the pipeline' }, { row: 51, reason: 'A name or a valid email is required' }],
  });
  assert.deepEqual(mergeImport([{ failed: true, count: 2, reason: 'Network' }]).skipped, [{ row: 1, reason: 'Network' }, { row: 2, reason: 'Network' }], 'a chunk that failed is reported row by row');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const PIPE = '/raise/capital-relationships/pipeline?project_id=3';

test('the board: five columns and Passed collapsed; moving a card to Committed asks the status and writes it through the one writer', async () => {
  // Mutation checked: the status field not drawn for Committed → Signed never sent; the write sent through contacts' PUT → no PATCH.
  const v = await mounted(PIPE);
  try {
    for (const s of ['to_contact', 'contacted', 'meeting', 'diligence', 'committed']) assert.ok(v.has(`caprel-col-${s}`), s);
    assert.ok(!v.text('caprel-col-passed').includes('Osprey Partners'), 'Passed starts collapsed');
    await v.click('caprel-passed-toggle');
    assert.ok(v.text('caprel-col-passed').includes('Osprey Partners'));
    assert.ok(v.text('caprel-card-44').includes(NO_STATUS) && v.text('caprel-card-44').includes('Amount not recorded'), 'never $0');
    assert.ok(v.text('caprel-card-43').includes('Wired') && v.text('caprel-card-43').includes('$50,000'));
    await v.change('caprel-card-move-41', 'committed');
    assert.ok(v.has('caprel-move-dialog') && v.has('caprel-status-field'));
    assert.match(v.text('caprel-move-dialog'), /Bluefern Capital will move from Meeting to Committed\./);
    await v.change('caprel-status-signed', 'signed');
    await v.click('caprel-move-go');
    const w = v.writes();
    assert.equal(w.length, 1);
    assert.match(w[0].url, /\/cycles\/raise\/prospects\/41\?project=3$/);
    assert.deepEqual([w[0].method, w[0].body], ['PATCH', { stage: 'committed', commit_status: 'signed' }]);
    assert.ok(!v.has('caprel-move-dialog'), 'closed after the write');
    assert.ok(!v.calls.some((c) => /\/contacts\/raise-prospects\/\d+/.test(c.url) && c.method !== 'GET'), 'never the old PUT');
  } finally { await v.close(); }
});

test('a move elsewhere asks no status; no status chosen on Committed is sent as not recorded', async () => {
  const v = await mounted(PIPE);
  try {
    await v.change('caprel-card-move-42', 'diligence');
    assert.ok(v.has('caprel-move-dialog') && !v.has('caprel-status-field'));
    await v.click('caprel-move-go');
    assert.deepEqual(v.writes().at(-1).body, { stage: 'diligence' });
    await v.change('caprel-card-move-47', 'committed');
    await v.click('caprel-move-go');
    assert.deepEqual(v.writes().at(-1).body, { stage: 'committed', commit_status: null });
  } finally { await v.close(); }
});

test('the list: rows with commitment and next step; three picked move together through the one writer', async () => {
  const v = await mounted(PIPE);
  try {
    await v.click('caprel-view-list');
    assert.ok(v.has('caprel-list') && !v.has('caprel-board'));
    assert.ok(v.text('caprel-row-44').includes(`${NO_STATUS} · Amount not recorded`));
    for (const id of [41, 42, 47]) await v.change(`caprel-pick-${id}`, true);
    assert.ok(v.text('caprel-bulk').startsWith('3 picked'));
    await v.click('caprel-bulk-move');
    assert.match(v.text('caprel-move-dialog'), /Move 3 investors/);
    await v.change('caprel-move-to', 'passed');
    await v.click('caprel-move-go');
    assert.deepEqual(v.writes().map((c) => [c.url.match(/prospects\/(\d+)/)[1], c.body]), [['41', { stage: 'passed' }], ['42', { stage: 'passed' }], ['47', { stage: 'passed' }]]);
  } finally { await v.close(); }
});

test('Import: the preview names the columns, the rows go to the one writer, and every skipped row is reported with why', async () => {
  // Mutation checked: the result not drawing `skipped` → no row reported.
  const v = await mounted(PIPE);
  try {
    await v.click('caprel-import');
    await v.change('caprel-import-text', 'Name,Email\nKite,kite@x.test\n,not-an-email\nHarbour,deals@harbour.test\n');
    assert.match(v.text('caprel-import-preview'), /Name → name, Email → email/);
    await v.click('caprel-import-go');
    const w = v.writes();
    assert.match(w[0].url, /\/cycles\/raise\/prospects\/import\?project=3$/);
    assert.equal(w[0].body.rows.length, 3, 'every data row is sent, the bad one too');
    assert.equal(v.text('caprel-import-result').split('.')[0], '1 of 3 added');
    assert.deepEqual(v.text('caprel-import-skipped').replace(/ :/g, ':'), 'Row 2: A name or a valid email is required Row 3: Already in the pipeline');
  } finally { await v.close(); }
});

test('Add investor: a duplicate email is answered inline and the dialog stays open', async () => {
  const v = await mounted(PIPE, { addStatus: 409 });
  try {
    await v.click('caprel-add');
    await v.change('caprel-add-name', 'Kite Again');
    await v.change('caprel-add-email', 'kite@x.test');
    await v.click('caprel-add-go');
    assert.deepEqual(v.writes()[0].body, { name: 'Kite Again', email: 'kite@x.test', stage: 'to_contact' });
    assert.match(v.text('caprel-add-error'), /Already in the pipeline/);
    assert.ok(v.has('caprel-add-dialog'));
  } finally { await v.close(); }
});

test('the investor lightbox reads the record; its next step, step and feedback go through the one writer and the record\'s actions', async () => {
  const v = await mounted(PIPE);
  try {
    const card = v.by('caprel-card-41');
    const open = card.childNodes.find((n) => String(n.tagName).toUpperCase() === 'BUTTON');
    await act(async () => Object.entries(open).find(([k]) => k.startsWith('__reactProps$'))[1].onClick());
    await v.flush();
    assert.ok(v.calls.some((c) => /\/modules\/capital-relationships\/records\/41\?project=3/.test(c.url)));
    assert.ok(v.text('caprel-investor-record').includes('Timeline'));
    await v.click('caprel-investor-next');
    await v.change('caprel-next-step', 'Partner meeting');
    await v.change('caprel-next-due', '2026-11-02');
    await v.click('caprel-next-go');
    const ns = v.writes().at(-1);
    assert.match(ns.url, /\/cycles\/raise\/prospects\/41\/next-step\?project=3$/);
    assert.deepEqual([ns.method, ns.body], ['PUT', { next_step: 'Partner meeting', next_step_due: '2026-11-02' }]);
    await v.click('caprel-investor-feedback');
    await v.change('caprel-feedback-said', 'Too early for us');
    await v.click('caprel-feedback-go');
    const fb = v.writes().at(-1);
    assert.match(fb.url, /\/records\/41\/actions\/add-feedback/);
    assert.deepEqual(fb.body, { objection: 'Too early for us' });
    await v.click('caprel-investor-step');
    await v.click('caprel-step-go');
    assert.match(v.writes().at(-1).url, /\/records\/41\/actions\/log/);
  } finally { await v.close(); }
});

test('Overview: the round from the commitments read, Needs you and the stages from the investors, each answering alone', async () => {
  // Mutation checked: the round block drawing `$0` for a missing total → "Not recorded" lost.
  const v = await mounted('/raise/capital-relationships?project_id=3');
  try {
    assert.ok(v.has('caprel-overview'));
    assert.equal(v.text('caprel-ov-counted').split(' ')[0], '$50,000');
    assert.ok(v.text('caprel-ov-counted').includes('of $2,000,000 · 2.5%'));
    assert.ok(v.has('caprel-ov-need-overdue') && v.has('caprel-ov-need-no-status'));
    assert.ok(v.text('caprel-ov-stage-committed').endsWith('2'));
    assert.ok(v.text('caprel-ov-stages').includes('Against 30 days ago: not recorded'));
  } finally { await v.close(); }
  const r = await mounted('/raise/capital-relationships?project_id=3', { commitments: null });
  try {
    assert.ok(r.text('caprel-ov-round').includes('This is not a claim that nobody has committed.'));
    assert.ok(r.has('caprel-ov-need-overdue'), 'the other blocks still answer');
  } finally { await r.close(); }
  const n = await mounted('/raise/capital-relationships?project_id=3', { commitments: { ...COMMITMENTS, round: null, round_reason: 'No active round is recorded, so there is no target to count against.', totals: {} } });
  try {
    assert.equal(n.text('caprel-ov-counted'), 'Not recorded', 'never $0 for a total that did not come back');
    assert.ok(n.has('caprel-ov-no-round'));
  } finally { await n.close(); }
});

test('the states: empty, a failed read, the moved notice, and the phone\'s one stage at a time', async () => {
  let v = await mounted(PIPE, { prospects: [] });
  try { assert.ok(v.has('caprel-pipeline-empty') && !v.has('caprel-board')); } finally { await v.close(); }
  v = await mounted(PIPE, { prospects: null });
  try { assert.match(v.text(), /This is not a claim that you have none\./); } finally { await v.close(); }
  v = await mounted(`${PIPE}&moved=pipeline`);
  try {
    assert.equal(v.text('caprel-moved').replace(' Dismiss', ''), MOVED.pipeline);
    await v.click('caprel-moved-dismiss');
    assert.ok(!v.has('caprel-moved'));
  } finally { await v.close(); }
  v = await mounted('/raise/capital-relationships?project_id=3&moved=match');
  try { assert.ok(v.text('caprel-moved').startsWith(MOVED.match)); } finally { await v.close(); }
  v = await mounted(PIPE, { phone: true });
  try {
    assert.ok(v.has('caprel-board-stage'));
    assert.ok(v.has('caprel-col-to_contact') && !v.has('caprel-col-meeting'), 'one stage at a time');
    await v.change('caprel-board-stage', 'meeting');
    assert.ok(v.has('caprel-col-meeting') && !v.has('caprel-col-to_contact'));
  } finally { await v.close(); }
});

test('the source: the Pipeline writes only through cyclesWrite and the record\'s actions, and draws every new colour in the dark', () => {
  const src = readFileSync('frontend/src/pages/raise/caprel/CapRelPipeline.jsx', 'utf8');
  assert.ok(!/raiseProspectUpdate|raiseProspectCreate|raiseProspectsImport/.test(src), 'never the old writes');
  assert.match(src, /cyclesWrite\.raise\.prospectUpdate/);
  assert.match(src, /cyclesWrite\.raise\.prospectsImport/);
  assert.ok(!/window\.(confirm|prompt|alert)/.test(src), 'dialogs only');
  for (const file of ['CapRelPipeline.jsx', 'CapRelOverview.jsx']) {
    const s = readFileSync(`frontend/src/pages/raise/caprel/${file}`, 'utf8');
    for (const cls of s.match(/\bbg-(?:white|gray-50|gray-100|violet-50)\b/g) || []) {
      assert.ok(s.includes(`dark:bg-`), `${file}: ${cls} needs a dark pair`);
    }
  }
});
