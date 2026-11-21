/**
 * D6203 (#6203): Value-add and the Overview's Value-add card draw what the support ledger records since D6202
 * (#6202): In progress and Overdue as counted figures, each row's due date with the Worker's own Overdue, an
 * introduction's meeting (Yes with its date, No, or Not recorded), Start and Cancel confirmed in place, Record
 * meeting, a due date on Log support, and Introductions made and Meetings resulting on the Overview. The real pages
 * are mounted against a stubbed `fetch` in their populated, Not recorded and Unreadable states.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/value_add_ledger_d6203.test.mjs
 *
 * Mutation checked, each failing at least one test here:
 *   1. `commitmentOf` working Overdue out from `due_date` and the browser's clock instead of the Worker's flag;
 *   2. `meetingOf` drawing an unrecorded meeting as "No";
 *   3. `figuresOf` drawing In progress or Overdue as Not recorded, or a failed read as 0;
 *   4. the in-progress row offering Start (moving back is refused by the Worker; the page must not offer it);
 *   5. Start or Cancel sending before the member confirms;
 *   6. Log support sending a mistyped due date, or a due date on a delivered entry;
 *   7. Outstanding reading `state=promised` (the in-progress entry vanishes from it);
 *   8. the Overview drawing a missing introduction figure as 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import InvestorPortfolioValueAdd from '../src/pages/investor/InvestorPortfolioValueAdd.jsx';
import InvestorPortfolioCanvas from '../src/pages/investor/InvestorPortfolioCanvas.jsx';
import { commitmentOf, figuresOf, introCounts, ledgerParams, meetingOf, validDay } from '../src/pages/portfolio/valueAddModel.js';
import { valueAddSummaryOf } from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ME = { id: 7, role: 'investor', name: 'Morgan' };

async function mount(answer, { page = 'value-add' } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(ME));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ line: `${method} ${url.pathname}${url.search}`, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname === '/api/auth/me') return json(ME);
    return answer({ path: url.pathname, query: url.searchParams, method, body: init.body ? JSON.parse(init.body) : null }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  const Page = page === 'overview' ? InvestorPortfolioCanvas : InvestorPortfolioValueAdd;
  const path = page === 'overview' ? '/portfolio' : '/portfolio/value-add';
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, h(Page)))));
  await settle();
  const field = (id) => nodes().find((n) => props(n).id === id);
  return {
    calls,
    box,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    all: (prefix) => nodes().filter((n) => String(props(n)['data-testid'] || '').startsWith(prefix))
      .map((n) => ({ id: props(n)['data-testid'], state: props(n)['data-state'], text: textOf(n) })),
    has: (id) => !!byTestId(id),
    async press(label, within) {
      const scope = within ? byTestId(within) : box;
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const node = walk(scope).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
      if (!node) throw new Error(`no button ${label}`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async click(id) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async change(id, value) {
      const node = field(id);
      if (!node) throw new Error(`no field ${id}`);
      await act(async () => { props(node).onChange({ target: { value } }); });
      await settle();
    },
    async choose(name, value) {
      const node = nodes().find((n) => props(n).name === name && props(n).value === value);
      if (!node) throw new Error(`no radio ${name}=${value}`);
      await act(async () => { props(node).onChange({ target: { value } }); });
      await settle();
    },
    fieldAttr: (id, name) => props(field(id) || {})[name],
    hasField: (id) => !!field(id),
    labelFor: (id) => nodes().some((n) => n.tagName === 'LABEL' && props(n).htmlFor === id),
    async submit(id) {
      const node = byTestId(id);
      await act(async () => { await props(node).onSubmit({ preventDefault() {} }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

/* ------------------------------------------------------------ the ledger */

const entry = (o) => ({
  fund_id: null, hours: null, promised_at: null, delivered_at: null, withdrawn_at: null, cancelled_at: null, outcome: null,
  due_date: null, meeting_outcome: null, meeting_at: null, overdue: false,
  recorded_by: 7, updated_at: o.created_at, revision: 1, updated_by: 7, ...o,
});

const ENTRIES = [
  // In progress, due in the past, and the Worker says overdue.
  entry({ uid: 'kite-pilot', project_id: 2, project_uid: 'kite', project_name: 'Kite Systems', kind: 'customer', state: 'in_progress', summary: 'Line up a pilot customer', due_date: '2026-11-01', overdue: true, created_at: '2026-10-20T10:00:00Z' }),
  // Promised, its due date is in the past by any clock, but the Worker says NOT overdue: the page follows the Worker.
  entry({ uid: 'nw-intro', project_id: 1, project_uid: 'northwind', project_name: 'Northwind Labs', kind: 'intro', state: 'promised', summary: 'Intro to a climate fund', due_date: '2020-01-15', overdue: false, created_at: '2026-10-14T09:00:00Z' }),
  // A delivered intro whose meeting was held, with its date.
  entry({ uid: 'pp-intro', project_id: 3, project_uid: 'pelican', project_name: 'Pelican Pay', kind: 'intro', state: 'delivered', summary: 'Intro to Nordbank', delivered_at: '2026-10-19', meeting_outcome: 'held', meeting_at: '2026-10-28', created_at: '2026-10-05T09:00:00Z' }),
  // A delivered intro whose meeting did not happen.
  entry({ uid: 'lu-intro', project_id: 4, project_uid: 'lumen', project_name: 'Lumen Robotics', kind: 'intro', state: 'delivered', summary: 'Intro to a robotics buyer', delivered_at: '2026-10-02', meeting_outcome: 'not_held', created_at: '2026-09-30T09:00:00Z' }),
  // A cancelled entry with its date.
  entry({ uid: 'kite-hire', project_id: 2, project_uid: 'kite', project_name: 'Kite Systems', kind: 'hiring', state: 'cancelled', summary: 'Find a VP Sales', cancelled_at: '2026-10-01', created_at: '2026-09-25T09:00:00Z' }),
];

const COMPANIES = [
  { project_id: 2, project_uid: 'kite', name: 'Kite Systems', entries: 2, delivered: 0, promised: 0, in_progress: 1, withdrawn: 0, cancelled: 1, overdue: 1, hours: 0, entries_without_hours: 2 },
  { project_id: 1, project_uid: 'northwind', name: 'Northwind Labs', entries: 1, delivered: 0, promised: 1, in_progress: 0, withdrawn: 0, cancelled: 0, overdue: 0, hours: 0, entries_without_hours: 1 },
  { project_id: 3, project_uid: 'pelican', name: 'Pelican Pay', entries: 1, delivered: 1, promised: 0, in_progress: 0, withdrawn: 0, cancelled: 0, overdue: 0, hours: 0, entries_without_hours: 1 },
  { project_id: 4, project_uid: 'lumen', name: 'Lumen Robotics', entries: 1, delivered: 1, promised: 0, in_progress: 0, withdrawn: 0, cancelled: 0, overdue: 0, hours: 0, entries_without_hours: 1 },
];

const zeroKind = { entries: 0, delivered: 0, outstanding: 0, meetings_held: 0 };
const TOTALS = {
  delivered: 2, promised: 1, withdrawn: 0, in_progress: 1, cancelled: 1, outstanding: 2, overdue: 1,
  overdue_basis: "open entries whose due date is before the Worker's date (UTC)",
  by_kind: { intro: { entries: 3, delivered: 2, outstanding: 1, meetings_held: 1 }, board_prep: zeroKind, hiring: { ...zeroKind, entries: 1 }, customer: { ...zeroKind, entries: 1, outstanding: 1 }, fundraising: zeroKind, other: zeroKind },
  entries: 5, hours_recorded: 0, entries_without_hours: 5, companies_in_book: 4, companies_supported: 4,
};

function ledger(over = {}) {
  const entries = over.entries || ENTRIES;
  return {
    entries,
    page: { offset: 0, limit: 400, total: entries.length, matching_total: entries.length, next_offset: null },
    page_state: 'recorded', filter: { state: null }, companies: COMPANIES, untouched: [],
    totals_basis: 'all_entries_in_scope', totals: TOTALS, totals_reason: null, ...over,
  };
}

function desk(overrides = {}) {
  return (req) => {
    const hit = overrides[`${req.method} ${req.path}`];
    if (typeof hit === 'function') { const r = hit(req); if (r) return r; }
    if (req.method === 'GET' && req.path === '/api/portfolio-support') {
      const state = req.query.get('state');
      if (!state) return json(ledger());
      const rows = ENTRIES.filter((e) => (state === 'open' ? e.state === 'promised' || e.state === 'in_progress' : e.state === state));
      return json(ledger({ entries: rows, filter: { state }, page: { offset: 0, limit: 400, total: 5, matching_total: rows.length, next_offset: null } }));
    }
    return null;
  };
}

/* ---------------------------------------------------------------- tests */

test('populated: In progress and Overdue are counted, each row has its due date and the Worker\'s Overdue, and meetings read Yes, No or Not recorded', async () => {
  const m = await mount(desk());
  try {
    assert.deepEqual(m.all('metric-').map((x) => [x.id, x.state]), [
      ['metric-open', 'ok'], ['metric-in_progress', 'ok'], ['metric-delivered', 'ok'],
      ['metric-intros', 'ok'], ['metric-overdue', 'ok'], ['metric-untouched', 'ok'],
    ]);
    assert.match(m.text('metric-open'), /^Open commitments2/);
    assert.match(m.text('metric-in_progress'), /^In progress1Started and not yet delivered$/);
    assert.match(m.text('metric-overdue'), /^Overdue commitments1Open entries past their due date, by the Worker’s date \(UTC\)$/);
    assert.match(m.text('metric-intros'), /^Introductions made2Delivered introduction entries · 1 meeting resulting$/);
    assert.match(m.text('va-ledger-records'), /never this device’s clock/);

    // Due dates and the Worker's Overdue: the chip follows the Worker's flag, never the date against a clock.
    assert.match(m.text('va-due-kite-pilot'), /^due 1 Nov 2026 Overdue$/);
    assert.ok(m.has('va-overdue-kite-pilot'));
    assert.match(m.text('va-due-nw-intro'), /^due 15 Jan 2020$/, 'a past due date the Worker did not call overdue draws no chip');
    assert.equal(m.has('va-overdue-nw-intro'), false);
    assert.match(m.text('va-due-kite-hire'), /^No due date$/);
    assert.match(m.text('row-va-commitment-kite-pilot'), /In progress/);
    assert.match(m.text('row-va-commitment-kite-hire'), /Cancelled25 Sep 2026No due dateCancelled 1 Oct 2026/);

    // Meetings: Yes with its date, No, and Not recorded (never "No").
    assert.match(m.text('va-meeting-pp-intro'), /^Meeting resulting: Yes · 28 Oct 2026$/);
    assert.match(m.text('va-meeting-lu-intro'), /^Meeting resulting: No$/);
    assert.match(m.text('va-meeting-nw-intro'), /^Meeting resulting: Not recorded$/);
    assert.equal(m.text('va-intro-meeting-pp-intro'), 'Yes · 28 Oct 2026');
    assert.equal(m.text('va-intro-meeting-lu-intro'), 'No');
    assert.equal(m.text('va-intro-meeting-nw-intro'), 'Not recorded');
    assert.equal(m.text('va-intros-counts'), '2 made · 1 open · 1 meeting resulting');

    // The moves each open state offers: in progress never offers Start; a closed entry offers none.
    assert.ok(m.has('button-va-start-nw-intro'));
    assert.ok(m.has('button-va-cancel-nw-intro'));
    assert.equal(m.has('button-va-start-kite-pilot'), false, 'work that started is not offered Start again');
    assert.ok(m.has('button-va-deliver-kite-pilot'));
    assert.ok(m.has('button-va-cancel-kite-pilot'));
    for (const uid of ['pp-intro', 'kite-hire']) assert.equal(m.has(`button-va-deliver-${uid}`) || m.has(`button-va-cancel-${uid}`), false, uid);
    assert.doesNotMatch(m.text('investor-portfolio-value-add'), /Unreadable|NaN|undefined|null/);
  } finally { await m.close(); }
});

test('Not recorded: a measured 0 stays 0, an entry with no due date says so, and an unrecorded meeting is never No', async () => {
  const quiet = ledger({
    entries: [ENTRIES[1]],
    totals: { ...TOTALS, in_progress: 0, overdue: 0, cancelled: 0, delivered: 0, promised: 1, outstanding: 1, entries: 1,
      by_kind: { ...TOTALS.by_kind, intro: { entries: 1, delivered: 0, outstanding: 1, meetings_held: 0 } } },
  });
  const m = await mount(desk({ 'GET /api/portfolio-support': () => json({ ...quiet, entries: [{ ...ENTRIES[1], due_date: null }] }) }));
  try {
    assert.match(m.text('metric-in_progress'), /^In progress0/);
    assert.match(m.text('metric-overdue'), /^Overdue commitments0/);
    assert.match(m.text('metric-intros'), /^Introductions made0Delivered introduction entries · 0 meetings resulting$/);
    assert.equal(m.text('va-due-nw-intro'), 'No due date');
    assert.equal(m.text('va-intro-meeting-nw-intro'), 'Not recorded');
    assert.match(m.text('va-intros'), /never No/);
  } finally { await m.close(); }
  // The model, directly.
  assert.deepEqual(meetingOf({ meeting_outcome: null }), { state: 'not_recorded', text: 'Not recorded', date: null, note: 'No meeting is recorded for this introduction.' });
  assert.deepEqual(meetingOf({ meeting_outcome: 'held', meeting_at: null }).date, null, 'a held meeting with no date keeps it unrecorded, not today');
  assert.equal(commitmentOf(entry({ uid: 'x', state: 'delivered', due_date: '2020-01-01', overdue: true, created_at: '2026-01-01T00:00:00Z' })).overdue, false, 'a closed entry is never overdue');
  assert.equal(commitmentOf(entry({ uid: 'y', state: 'promised', due_date: '2020-01-01', overdue: false, created_at: '2026-01-01T00:00:00Z' })).overdue, false, 'the page never works Overdue out for itself');
  assert.equal(commitmentOf(entry({ uid: 'z', kind: 'hiring', state: 'promised', created_at: '2026-01-01T00:00:00Z' })).meeting, null, 'only an introduction carries a meeting');
});

test('Unreadable: figures whose read failed are Unreadable, never 0, beside the entries that were read', async () => {
  const half = ledger({ totals: null, page_state: 'unreadable', totals_reason: 'Unreadable', page: { offset: 0, limit: 400, total: 5, matching_total: null, next_offset: null } });
  const m = await mount(desk({ 'GET /api/portfolio-support': () => json(half) }));
  try {
    for (const k of ['open', 'in_progress', 'intros', 'overdue']) assert.equal(m.all(`metric-${k}`)[0].state, 'unreadable', k);
    assert.doesNotMatch(m.text('va-figures'), /\b0\b/, 'no zero for a failure');
    assert.match(m.text('va-due-kite-pilot'), /Overdue/, 'the entries beside the failed figures still carry their own Overdue');
    assert.equal(m.has('va-intros-counts'), false, 'no introduction counts over a failed figure read');
  } finally { await m.close(); }
  const f = Object.fromEntries(figuresOf({ state: 'ok', value: ledger({ totals: { ...TOTALS, in_progress: undefined } }) }).map((x) => [x.key, x]));
  assert.equal(f.in_progress.state, 'unreadable', 'a figure the read did not carry is Unreadable, not 0');
  assert.equal(introCounts(null), null);
  assert.deepEqual(introCounts({ by_kind: { intro: { delivered: 2, outstanding: null, meetings_held: 0 } } }), { made: 2, open: null, meetings: 0 });
});

test('Start and Cancel confirm in place, naming the entry and its company; nothing is sent until the member confirms', async () => {
  const sent = [];
  const m = await mount(desk({
    'PATCH /api/portfolio-support/nw-intro': ({ body }) => { sent.push(body); return json({ item: { ...ENTRIES[1], state: body.state, revision: 2 } }); },
    'PATCH /api/portfolio-support/kite-pilot': ({ body }) => { sent.push(body); return json({ detail: { code: 'cannot_reopen', message: 'This entry is already in progress, so it cannot move back to promised.' } }, 409); },
  }));
  try {
    await m.click('button-va-start-nw-intro');
    assert.match(m.text('va-confirm-nw-intro'), /^Start “Intro to a climate fund” for Northwind Labs\? It moves to In progress, and work that has started cannot move back to Promised\./);
    assert.equal(sent.length, 0, 'nothing is sent before the member confirms');
    await m.click('button-va-confirm-nw-intro');
    assert.deepEqual(sent[0], { state: 'in_progress', project_uid: 'northwind', expected_revision: 1 });
    assert.equal(m.text('va-confirm-nw-intro'), null, 'a saved move closes its confirmation');

    await m.click('button-va-cancel-kite-pilot');
    assert.match(m.text('va-confirm-kite-pilot'), /^Cancel “Line up a pilot customer” for Kite Systems\? The entry stays in the ledger as cancelled, with today’s date, and cannot be reopened\./);
    assert.match(m.text('va-confirm-kite-pilot'), /Cancel entryKeep entry$/, 'the dismiss button is not a second "Cancel"');
    await m.press('Keep entry', 'va-confirm-kite-pilot');
    assert.equal(m.text('va-confirm-kite-pilot'), null);
    assert.equal(sent.length, 1, 'Keep entry sends nothing');
    await m.click('button-va-cancel-kite-pilot');
    await m.click('button-va-confirm-kite-pilot');
    assert.deepEqual(sent[1], { state: 'cancelled', project_uid: 'kite', expected_revision: 1 });
    assert.match(m.text('status-va-support-blocked'), /^Kite Systems: This entry is already in progress/, 'a refused move is named against its entry');
  } finally { await m.close(); }
});

test('Record meeting: Yes with a date or No, checked before it is sent, on the introduction alone', async () => {
  const sent = [];
  const m = await mount(desk({ 'PATCH /api/portfolio-support/nw-intro': ({ body }) => { sent.push(body); return json({ item: ENTRIES[1] }); } }));
  try {
    assert.equal(m.has('button-va-meeting-kite-pilot'), false, 'only an introduction records a meeting');
    assert.equal(m.has('button-va-meeting-kite-hire'), false);
    await m.click('button-va-meeting-nw-intro');
    assert.match(m.text('va-meeting-form-nw-intro'), /Did the introduction “Intro to a climate fund” for Northwind Labs lead to a meeting\?/);
    assert.ok(m.labelFor('va-meeting-at-nw-intro'), 'the date field is labelled');
    await m.change('va-meeting-at-nw-intro', '2026-02-30');
    await m.click('button-va-meeting-save-nw-intro');
    assert.equal(sent.length, 0, 'a date that is not a real day is refused in the form');
    assert.equal(m.fieldAttr('va-meeting-at-nw-intro', 'aria-invalid'), true);
    await m.change('va-meeting-at-nw-intro', '2026-11-10');
    await m.click('button-va-meeting-save-nw-intro');
    assert.deepEqual(sent[0], { meeting_outcome: 'held', meeting_at: '2026-11-10', project_uid: 'northwind', expected_revision: 1 });

    await m.click('button-va-meeting-nw-intro');
    await m.choose('va-meeting-nw-intro', 'not_held');
    assert.equal(m.hasField('va-meeting-at-nw-intro'), false, 'No meeting asks for no date');
    await m.click('button-va-meeting-save-nw-intro');
    assert.deepEqual(sent[1], { meeting_outcome: 'not_held', meeting_at: null, project_uid: 'northwind', expected_revision: 1 });
  } finally { await m.close(); }
});

test('Log support: a labelled, validated due date, sent only for an open entry; In progress may be logged', async () => {
  const posts = [];
  const m = await mount(desk({ 'POST /api/portfolio-support': ({ body }) => { posts.push(body); return json({ item: { id: 1 } }); } }));
  try {
    await m.press('Log support');
    assert.ok(m.labelFor('va-due'), 'the due date is labelled');
    assert.equal(m.fieldAttr('va-due', 'type'), 'date');
    await m.change('va-company', 'northwind');
    await m.change('va-summary', 'Introduce a design partner');
    await m.change('va-due', '2026-13-01');
    await m.submit('va-log-support');
    assert.equal(posts.length, 0, 'a mistyped due date is refused before anything is sent');
    assert.match(m.text('va-form-error'), /Enter the due date as a full date, or leave it blank\./);
    assert.equal(m.fieldAttr('va-due', 'aria-invalid'), true);
    assert.equal(m.fieldAttr('va-due', 'aria-describedby'), 'va-form-error');
    await m.change('va-due', '2026-12-15');
    await m.change('va-state', 'in_progress');
    await m.submit('va-log-support');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].due_date, '2026-12-15');
    assert.equal(posts[0].state, 'in_progress');

    await m.press('Log support');
    await m.change('va-company', 'northwind');
    await m.change('va-summary', 'Already done');
    await m.change('va-due', '2026-12-15');
    await m.change('va-state', 'delivered');
    assert.equal(m.hasField('va-due'), false, 'a delivered entry is never overdue, so it is not asked for a due date');
    await m.submit('va-log-support');
    assert.equal('due_date' in posts[1], false, 'a due date typed before choosing Delivered is not sent');
  } finally { await m.close(); }
  assert.equal(validDay('2024-02-29'), true);
  assert.equal(validDay('2025-02-29'), false);
  assert.equal(validDay('15/12/2026'), false);
});

test('Outstanding is both open states: the in-progress entry stays in it', async () => {
  assert.deepEqual(ledgerParams('outstanding', 0), { state: 'open' });
  const m = await mount(desk());
  try {
    await m.press('Outstanding');
    assert.ok(m.calls.some((c) => c.line === 'GET /api/portfolio-support?state=open'));
    assert.deepEqual(m.all('row-va-commitment-').map((r) => r.id.slice(18)), ['kite-pilot', 'nw-intro']);
    assert.match(m.text('va-commitments'), /Promised or in progress, still open/);
  } finally { await m.close(); }
});

test('Overview: the Value-add card shows Introductions made and Meetings resulting, and a missing figure is Unreadable, never 0', async () => {
  assert.deepEqual(
    (({ open, introductions, meetings }) => ({ open, introductions, meetings }))(valueAddSummaryOf({ state: 'ok', value: { untouched: [], totals: TOTALS } })),
    { open: 2, introductions: 2, meetings: 1 },
  );
  const lacking = valueAddSummaryOf({ state: 'ok', value: { untouched: [], totals: { delivered: 1, promised: 1 } } });
  assert.equal(lacking.introductions, null);
  assert.equal(lacking.meetings, null);
  const m = await mount(({ path }) => (path === '/api/portfolio-support' ? json(ledger()) : null), { page: 'overview' });
  try {
    assert.match(m.text('portfolio-support-figures'), /Introductions made2Delivered introduction entries/);
    assert.match(m.text('portfolio-support-figures'), /Meetings resulting1Introductions whose meeting a member recorded as held/);
    assert.match(m.text(), /one nobody recorded is not counted as no meeting/);
  } finally { await m.close(); }
});

test('phone: the row\'s moves wrap at 390px, and the new chips use the shell\'s tokens so dark mode follows', () => {
  const css = readFileSync('frontend/src/pages/portfolio/valueAdd.css', 'utf8');
  assert.match(css, /\.va-moves\{flex-direction:row;flex-wrap:wrap;width:100%\}/, 'four moves on a phone wrap instead of pushing the page sideways');
  for (const rule of ['.va-state.is-in_progress', '.va-state.is-cancelled', '.va-overdue']) {
    const body = css.slice(css.indexOf(rule)).split('}')[0];
    assert.ok(body.includes('{'), rule);
    assert.doesNotMatch(body, /#[0-9a-f]{3,6}/i, `${rule} uses tokens, not a fixed colour`);
  }
});
