/**
 * D4817 part 5 (#5311, canvas PF-05, addendum PFA08): Value-add, the support
 * ledger in the shared Portfolio frame. The real page is mounted against a
 * stubbed `fetch` in its populated, Not recorded and Unreadable states, plus
 * the pure model it adds (`pages/portfolio/valueAddModel.js`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_value_add_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   1. `figuresOf` drawing In progress as 0 instead of Not recorded → tests 1, 2, 3, 5;
 *   2. `figuresOf` drawing Overdue as the open count instead of Not recorded → tests 1, 2, 5;
 *   3. `holdsWholeLedger` dropping the `entries.length === totals.entries`
 *      check (introductions counted over a partial read) → tests 2, 5;
 *   4. `totalsOf` ignoring `page_state: 'unreadable'` (figures drawn from a
 *      failed aggregate) → test 5;
 *   5. `hoursLabel` drawing an untimed entry as `0 h` → tests 1, 5;
 *   6. `ownerOf` naming every recorder "You" → tests 1, 5;
 *   7. `commitmentOf` taking `created_at` as the delivery date when
 *      `delivered_at` is null → tests 1, 5;
 *   8. the Commitments table drawing its empty state over a failed read →
 *      tests 3, 4;
 *   9. a filtered page's Retry re-reading the whole ledger as well as its own
 *      page → test 4;
 *  10. the introductions table dropping its "Meeting resulting" Not recorded →
 *      test 1;
 *  11. a failed Mark delivered clearing its confirmation (entry and context
 *      lost) → test 6;
 *  12. a failed history read drawn as "No amendment is recorded." → test 4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import InvestorPortfolioValueAdd from '../src/pages/investor/InvestorPortfolioValueAdd.jsx';
import {
  commitmentOf, figuresOf, holdsWholeLedger, hoursLabel, hoursOf, introductionsOf, ownerOf, totalsOf,
} from '../src/pages/portfolio/valueAddModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ME = { id: 7, role: 'investor', name: 'Morgan' };

async function mount(answer) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(ME));
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
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
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/value-add'] }, h(AuthProvider, null, h(InvestorPortfolioValueAdd)))));
  await settle();
  return {
    calls,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    attr: (id, name) => props(byTestId(id) || {})[name],
    all: (prefix) => nodes().filter((n) => String(props(n)['data-testid'] || '').startsWith(prefix))
      .map((n) => ({ id: props(n)['data-testid'], state: props(n)['data-state'], text: textOf(n) })),
    hrefs: () => nodes().filter((n) => n.tagName === 'A').map((n) => props(n).href || props(n).to),
    /** The button whose text is exactly `label`, inside the node with test id `within` (or anywhere). */
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
    /** Type into the field whose element id is `id`. */
    async change(id, value) {
      const node = nodes().find((n) => props(n).id === id);
      if (!node) throw new Error(`no field ${id}`);
      await act(async () => { props(node).onChange({ target: { value } }); });
      await settle();
    },
    value: (id) => props(nodes().find((n) => props(n).id === id) || {}).value,
    fieldAttr: (id, name) => props(nodes().find((n) => props(n).id === id) || {})[name],
    async submit(id) {
      const node = byTestId(id);
      if (!node) throw new Error(`no ${id}`);
      await act(async () => { await props(node).onSubmit({ preventDefault() {} }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

/* ------------------------------------------------------------ the ledger */

const entry = (o) => ({
  fund_id: null, hours: null, promised_at: null, delivered_at: null, withdrawn_at: null, outcome: null,
  recorded_by: 7, updated_at: o.created_at, revision: 1, updated_by: 7, ...o,
});

const ENTRIES = [
  entry({ uid: 'kite-review', project_id: 2, project_uid: 'kite', project_name: 'Kite Systems', kind: 'customer', state: 'promised', hours: 2, summary: 'Review pricing model', recorded_by: 9, created_at: '2026-11-02T10:00:00Z' }),
  entry({ uid: 'nw-intro', project_id: 1, project_uid: 'northwind', project_name: 'Northwind Labs', kind: 'intro', state: 'promised', summary: 'Intro to two climate-fund partners', promised_at: '2026-10-14', created_at: '2026-10-14T09:00:00Z' }),
  entry({ uid: 'pp-intro', project_id: 3, project_uid: 'pelican', project_name: 'Pelican Pay', kind: 'intro', state: 'delivered', hours: 1.5, summary: 'Intro to Head of Payments, Nordbank', outcome: 'Intro made', delivered_at: '2026-10-19', created_at: '2026-10-05T09:00:00Z', revision: 2 }),
  entry({ uid: 'kite-hire', project_id: 2, project_uid: 'kite', project_name: 'Kite Systems', kind: 'hiring', state: 'withdrawn', summary: 'Find a VP Sales', withdrawn_at: '2026-10-01', recorded_by: 9, created_at: '2026-09-25T09:00:00Z' }),
  // A delivered entry with no delivery date recorded, and a measured zero of hours.
  entry({ uid: 'lu-deck', project_id: 4, project_uid: 'lumen', project_name: 'Lumen Robotics', kind: 'board_prep', state: 'delivered', hours: 0, summary: 'Board-deck review', recorded_by: null, created_at: '2026-09-20T09:00:00Z' }),
];

const COMPANIES = [
  { project_id: 2, project_uid: 'kite', name: 'Kite Systems', entries: 2, delivered: 0, promised: 1, withdrawn: 1, hours: 2, entries_without_hours: 1 },
  { project_id: 1, project_uid: 'northwind', name: 'Northwind Labs', entries: 1, delivered: 0, promised: 1, withdrawn: 0, hours: 0, entries_without_hours: 1 },
  { project_id: 3, project_uid: 'pelican', name: 'Pelican Pay', entries: 1, delivered: 1, promised: 0, withdrawn: 0, hours: 1.5, entries_without_hours: 0 },
  { project_id: 4, project_uid: 'lumen', name: 'Lumen Robotics', entries: 1, delivered: 1, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 },
  { project_id: 5, project_uid: 'aster', name: 'Aster Bio', entries: 0, delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 },
];

const TOTALS = { delivered: 2, promised: 2, withdrawn: 1, entries: 5, hours_recorded: 3.5, entries_without_hours: 2, companies_in_book: 5, companies_supported: 4 };

function ledger(over = {}) {
  const entries = over.entries || ENTRIES;
  return {
    entries,
    page: { offset: 0, limit: 400, total: entries.length, matching_total: entries.length, next_offset: null },
    page_state: 'recorded', filter: { state: null },
    companies: COMPANIES,
    untouched: [{ project_id: 5, project_uid: 'aster', name: 'Aster Bio' }],
    totals_basis: 'all_entries_in_scope',
    totals: TOTALS,
    totals_reason: null,
    ...over,
  };
}

function desk(overrides = {}) {
  return (req) => {
    const hit = overrides[`${req.method} ${req.path}`];
    if (typeof hit === 'function') { const r = hit(req); if (r) return r; }
    if (req.method === 'GET' && req.path === '/api/portfolio-support') {
      const state = req.query.get('state');
      if (!state) return json(ledger());
      const rows = ENTRIES.filter((e) => e.state === state);
      return json(ledger({ entries: rows, filter: { state }, page: { offset: 0, limit: 400, total: 5, matching_total: rows.length, next_offset: null } }));
    }
    return null;
  };
}

const ledgerReads = (calls) => calls.filter((c) => c === 'GET /api/portfolio-support').length;

/* ---------------------------------------------------------------- tests */

test('populated: the figures, commitments promised and delivered with dates and owners, introductions with meetings Not recorded', async () => {
  const m = await mount(desk());
  try {
    assert.equal(document.title, 'Value-add · Portfolio · Axal VC');
    assert.equal(m.attr('link-zone-value-add', 'aria-current'), 'page');
    assert.equal(m.attr('link-zone-overview', 'aria-current'), undefined);
    // The figure row, in the canvas's order.
    assert.deepEqual(m.all('metric-').map((x) => [x.id, x.state]), [
      ['metric-open', 'ok'], ['metric-in_progress', 'not_recorded'], ['metric-delivered', 'ok'],
      ['metric-intros', 'ok'], ['metric-overdue', 'not_recorded'], ['metric-untouched', 'ok'],
    ]);
    assert.match(m.text('metric-open'), /^Open commitments2Promised and not yet delivered or withdrawn$/);
    assert.match(m.text('metric-in_progress'), /^In progressNot recordedThe ledger has no In progress state\.$/);
    assert.match(m.text('metric-delivered'), /^Delivered24 of 5 companies in the book have an entry$/);
    assert.match(m.text('metric-intros'), /^Introductions made1Delivered introduction entries · 1 still promised$/);
    assert.match(m.text('metric-overdue'), /^Overdue commitmentsNot recordedThe ledger records no due date for a commitment\.$/);
    assert.match(m.text('metric-untouched'), /^No support recorded1Aster Bio$/);
    assert.match(m.text('va-hours'), /Hours recorded: 3\.5 h · 2 entries carry no hours and are not counted\./);

    // Commitments: newest first, each with its owner, state and dates.
    const rows = m.all('row-va-commitment-');
    assert.deepEqual(rows.map((r) => [r.id.slice(18), r.state]), [
      ['kite-review', 'promised'], ['nw-intro', 'promised'], ['pp-intro', 'delivered'], ['kite-hire', 'withdrawn'], ['lu-deck', 'delivered'],
    ]);
    assert.match(m.text('row-va-commitment-kite-review'), /^Kite SystemsCustomerReview pricing modelHours: 2 hAnother memberPromised2 Nov 2026Not delivered yet/);
    assert.match(m.text('row-va-commitment-nw-intro'), /Hours: Not recorded/, 'an untimed entry is not 0 h');
    assert.match(m.text('row-va-commitment-nw-intro'), /You.*Promised14 Oct 2026promised 14 Oct 2026Not delivered yet.*Meeting resulting: Not recorded/);
    assert.match(m.text('row-va-commitment-pp-intro'), /Delivered5 Oct 202619 Oct 2026Outcome: Intro madeMeeting resulting: Not recorded/);
    assert.match(m.text('row-va-commitment-pp-intro'), /History · amended 1 time/);
    assert.match(m.text('row-va-commitment-kite-hire'), /Withdrawn25 Sep 2026Withdrawn 1 Oct 2026/);
    assert.match(m.text('row-va-commitment-lu-deck'), /Hours: 0 h/, 'a measured zero stays 0');
    assert.match(m.text('row-va-commitment-lu-deck'), /Not recorded.*Delivered20 Sep 2026Delivery date not recorded/, 'a delivered entry with no date says so; no recorder is Not recorded');
    assert.ok(m.text('button-va-deliver-kite-review'), 'an open commitment offers Mark delivered');
    assert.equal(m.text('button-va-deliver-pp-intro'), null, 'a delivered entry offers none');

    // Introductions: the ledger's own intro entries, each with its meeting Not recorded.
    assert.deepEqual(m.all('row-va-intro-').map((r) => r.id.slice(13)), ['nw-intro', 'pp-intro']);
    assert.match(m.text('row-va-intro-pp-intro'), /Pelican PayIntro to Head of Payments, NordbankOutcome: Intro madeDelivered5 Oct 202619 Oct 2026Not recorded$/);
    assert.match(m.text('va-intros'), /1 delivered · 1 promised/);
    assert.match(m.text('va-intros'), /not the meetings that came of it/);
    assert.equal(m.text('va-intros-partial'), null);

    for (const uid of ['kite', 'northwind', 'pelican', 'lumen']) assert.ok(m.hrefs().includes(`/portfolio/companies/${uid}`), uid);
    assert.equal(ledgerReads(m.calls), 1, 'one ledger read draws the figures, the commitments and the introductions');
    assert.doesNotMatch(m.text('investor-portfolio-value-add'), /Unreadable|NaN|undefined|null/);
    assert.doesNotMatch(m.text(), /advis|recommend|fiduciar|#\d{3,}|D4817/i);
  } finally { await m.close(); }
});

test('Not recorded: an empty ledger is not a failed one, and an unrecorded field is never 0', async () => {
  const empty = ledger({
    entries: [], untouched: COMPANIES.map(({ project_id, project_uid, name }) => ({ project_id, project_uid, name })),
    companies: COMPANIES.map((c) => ({ ...c, entries: 0, delivered: 0, promised: 0, withdrawn: 0, hours: 0, entries_without_hours: 0 })),
    totals: { delivered: 0, promised: 0, withdrawn: 0, entries: 0, hours_recorded: 0, entries_without_hours: 0, companies_in_book: 5, companies_supported: 0 },
    page: { offset: 0, limit: 400, total: 0, matching_total: 0, next_offset: null },
  });
  const m = await mount(desk({ 'GET /api/portfolio-support': () => json(empty) }));
  try {
    // Measured zeros stay 0; what the ledger does not record stays Not recorded.
    assert.match(m.text('metric-open'), /^Open commitments0/);
    assert.match(m.text('metric-delivered'), /^Delivered00 of 5 companies/);
    assert.match(m.text('metric-intros'), /^Introductions made0/);
    assert.match(m.text('metric-in_progress'), /Not recorded/);
    assert.match(m.text('metric-overdue'), /Not recorded/);
    assert.match(m.text('metric-untouched'), /^No support recorded5Kite Systems, Northwind Labs, Pelican Pay, Lumen Robotics, Aster Bio$/);
    assert.match(m.text('va-hours'), /Hours recorded: 0 h · No entry is recorded yet\./);
    assert.match(m.text('va-commitments-empty'), /No support entry is recorded yet\. The ledger is empty because nothing has been logged, not because nothing was done\./);
    assert.match(m.text('va-intros-none'), /^Not recorded · No introduction entry is recorded in the support ledger\.$/);
    assert.doesNotMatch(m.text('investor-portfolio-value-add'), /Unreadable|could not be read/);
    // By company: every company in the book, the empty ones included.
    await m.press('By company');
    assert.equal(m.all('row-va-company-').length, 5);
    assert.match(m.text('row-va-company-5'), /Aster BioNo support recorded0000Not recorded/);
  } finally { await m.close(); }
  // Every entry untimed: the hours read Not recorded, not 0 h.
  const untimed = ledger({ totals: { ...TOTALS, hours_recorded: 0, entries_without_hours: 5 } });
  const n = await mount(desk({ 'GET /api/portfolio-support': () => json(untimed) }));
  try { assert.match(n.text('va-hours'), /Hours recorded: Not recorded · No entry carries an hour count\./); } finally { await n.close(); }
  // A ledger longer than one read: the introductions on it cannot be shown to be all of them.
  const longer = ledger({ totals: { ...TOTALS, entries: 6 }, page: { offset: 0, limit: 5, total: 6, matching_total: 6, next_offset: 5 } });
  const o = await mount(desk({ 'GET /api/portfolio-support': ({ query }) => (query.get('offset') ? null : json(longer)) }));
  try {
    assert.equal(o.all('metric-intros')[0].state, 'unavailable');
    assert.match(o.text('metric-intros'), /^Introductions madeUnavailableCounted only over a read that holds every entry; this one holds the newest 5 of 6\.$/);
    assert.match(o.text('va-intros-partial'), /newest 5 of 6/);
    assert.match(o.text('va-commitments'), /1–5 of 6 matching entries/);
  } finally { await o.close(); }
});

test('Unreadable: a failed ledger read, and figures whose own read failed beside readable entries', async () => {
  let fail = true;
  const m = await mount(desk({ 'GET /api/portfolio-support': () => (fail ? json({ detail: 'D1_ERROR: no such table' }, 500) : null) }));
  try {
    assert.match(m.text('status-investor-value-add-error'), /The support ledger could not be read\. That is not a claim that no support was given\./);
    assert.match(m.text('status-va-commitments-unreadable'), /could not be read/);
    assert.equal(m.text('va-commitments-empty'), null, 'no empty ledger over a failed read');
    for (const k of ['open', 'delivered', 'untouched', 'intros']) assert.equal(m.all(`metric-${k}`)[0].state, 'unreadable', k);
    assert.match(m.text('status-va-intros-unreadable'), /That is not a claim that none was made\./);
    assert.doesNotMatch(m.text(), /D1_ERROR|no such table/, 'the Worker detail never reaches the page');
    assert.doesNotMatch(m.text('va-figures'), /\b0\b/, 'no zero for a failure');
    fail = false;
    await m.click('button-retry-value-add-ledger');
    assert.equal(m.all('metric-open')[0].state, 'ok');
    assert.equal(m.all('row-va-commitment-').length, 5);
  } finally { await m.close(); }

  // The aggregate read failed (`totals: null`); the entries were read.
  const half = ledger({ totals: null, page_state: 'unreadable', totals_reason: 'Unreadable — the support ledger\'s figures could not be read', page: { offset: 0, limit: 400, total: 5, matching_total: null, next_offset: null } });
  const n = await mount(desk({ 'GET /api/portfolio-support': () => json(half) }));
  try {
    assert.match(n.text('status-va-figures-unreadable'), /The ledger’s figures could not be read\. No count is shown in their place; the entries below were read\./);
    assert.equal(n.all('metric-open')[0].state, 'unreadable');
    assert.equal(n.all('metric-in_progress')[0].state, 'not_recorded', 'what the ledger never records stays Not recorded, not Unreadable');
    assert.equal(n.all('metric-intros')[0].state, 'unavailable', 'introductions cannot be shown to be all of them');
    assert.match(n.text('va-intros-partial'), /total could not be read/);
    assert.equal(n.all('row-va-commitment-').length, 5, 'the entries beside the failed figures stand');
    assert.equal(n.all('row-va-intro-').length, 2);
    assert.match(n.text('va-hours'), /Hours recorded: Unreadable/);
    assert.equal(n.text('status-investor-value-add-error'), null, 'the ledger itself was read');
  } finally { await n.close(); }
});

test('Unreadable per source: a filtered page and one entry\'s history each fail and retry on their own', async () => {
  let pageFails = true;
  let historyFails = true;
  const m = await mount(desk({
    'GET /api/portfolio-support': ({ query }) => (query.get('state') === 'promised' && pageFails ? json({ detail: 'x' }, 503) : null),
    'GET /api/portfolio-support/pp-intro/history': () => (historyFails ? json({ detail: 'x' }, 500) : json({ items: [{ uid: 'e1', revision: 2, action: 'amended', actor: { name: 'Priya' }, created_at: '2026-10-20T08:00:00Z', changed: ['outcome'] }] })),
  }));
  try {
    await m.press('Outstanding');
    assert.match(m.text('status-va-commitments-unreadable'), /could not be read/);
    assert.equal(m.text('va-commitments-empty'), null);
    // The ledger's own read still stands: figures and introductions are current.
    assert.equal(m.all('metric-open')[0].state, 'ok');
    assert.equal(m.all('row-va-intro-').length, 2);
    const before = ledgerReads(m.calls);
    pageFails = false;
    await m.click('button-retry-va-commitments');
    assert.equal(ledgerReads(m.calls), before, 'the page\'s Retry reads its page alone');
    assert.deepEqual(m.all('row-va-commitment-').map((r) => r.id.slice(18)), ['kite-review', 'nw-intro']);

    await m.press('All');
    await m.click('button-va-history-pp-intro');
    assert.match(m.text('status-va-history-unreadable-pp-intro'), /This entry’s history could not be read\. The entry itself is as shown\./);
    assert.doesNotMatch(m.text('history-va-support-pp-intro'), /No amendment is recorded/);
    historyFails = false;
    await m.click('button-retry-va-history-pp-intro');
    assert.match(m.text('history-va-support-pp-intro'), /Amended by Priya20 Oct 2026 · revision 2 · outcome/);
  } finally { await m.close(); }
});

test('the model: what the ledger records, what it does not, and when a count is the ledger\'s', () => {
  const ok = { state: 'ok', value: ledger() };
  assert.equal(holdsWholeLedger(ok), true);
  assert.equal(holdsWholeLedger({ state: 'ok', value: ledger({ entries: ENTRIES.slice(0, 3) }) }), false, 'a page short of the total is not the ledger');
  assert.equal(totalsOf({ state: 'ok', value: ledger({ page_state: 'unreadable' }) }), null);
  const f = Object.fromEntries(figuresOf(ok).map((x) => [x.key, x]));
  assert.deepEqual([f.in_progress.value, f.overdue.value], ['Not recorded', 'Not recorded']);
  assert.equal(f.open.value, '2');
  const partial = introductionsOf({ state: 'ok', value: ledger({ entries: ENTRIES.slice(0, 3) }) });
  assert.equal(partial.complete, false);
  assert.match(partial.reason, /newest 3 of 5/);
  assert.equal(Object.fromEntries(figuresOf({ state: 'ok', value: ledger({ entries: ENTRIES.slice(0, 3) }) }).map((x) => [x.key, x])).intros.state, 'unavailable');
  assert.equal(hoursLabel(null), 'Not recorded');
  assert.equal(hoursLabel(0), '0 h');
  assert.equal(hoursOf({ state: 'unreadable' }).text, 'Unreadable');
  assert.deepEqual(ownerOf({ recorded_by: 7 }, 7), { text: 'You' });
  assert.equal(ownerOf({ recorded_by: 9 }, 7).text, 'Another member');
  assert.equal(ownerOf({ recorded_by: null }, 7).text, 'Not recorded');
  const lu = commitmentOf(ENTRIES[4], 7);
  assert.equal(lu.closed.date, null);
  assert.equal(lu.closed.missing, 'Delivery date not recorded');
  assert.equal(commitmentOf(ENTRIES[2], 7).closed.date, '19 Oct 2026');
});

test('Mark delivered confirms in place naming the entry and company; a failed save keeps both, a conflict reloads', async () => {
  let attempt = 0;
  const m = await mount(desk({
    'PATCH /api/portfolio-support/kite-review': ({ body }) => {
      attempt += 1;
      assert.deepEqual(body, { state: 'delivered', project_uid: 'kite', expected_revision: 1 }, 'the write names the record and the revision it read');
      if (attempt === 1) return json({ detail: 'Service unavailable' }, 503);
      return json({ detail: { code: 'changed_since_open', message: 'changed', item: { ...ENTRIES[0], revision: 2 } } }, 409);
    },
  }));
  try {
    await m.click('button-va-deliver-kite-review');
    assert.match(m.text('va-confirm-kite-review'), /Mark “Review pricing model” for Kite Systems as delivered\?/);
    assert.equal(attempt, 0, 'nothing is sent before the member confirms');
    const before = ledgerReads(m.calls);
    await m.click('button-va-confirm-kite-review');
    assert.equal(attempt, 1);
    assert.match(m.text('va-confirm-error-kite-review'), /^Kite Systems: this did not save\./);
    assert.match(m.text('va-confirm-kite-review'), /Review pricing model.*Kite Systems.*Try saving again/, 'the entry and its context stay');
    assert.equal(ledgerReads(m.calls), before, 'a failed save does not re-read or blank the ledger');
    assert.equal(m.all('metric-open')[0].state, 'ok');
    await m.click('button-va-confirm-kite-review');
    assert.equal(attempt, 2);
    assert.match(m.text('status-va-support-conflict'), /^Kite Systems: someone else changed this entry since this page read it\. Their change is shown\./);
    assert.equal(m.text('va-confirm-kite-review'), null);
    assert.equal(ledgerReads(m.calls), before + 1, 'a conflict reads the ledger again to show the accepted change');
  } finally { await m.close(); }
});

test('Log support: labelled fields, validation tied to the field, and a failed save keeps the entries', async () => {
  let posts = 0;
  const m = await mount(desk({ 'POST /api/portfolio-support': ({ body }) => { posts += 1; assert.equal('hours' in body, false, 'a blank hours field is sent as absent, never 0'); return json({ detail: 'Service unavailable' }, 503); } }));
  try {
    await m.press('Log support');
    assert.ok(m.text('va-log-support'));
    await m.submit('va-log-support');
    assert.equal(posts, 0);
    assert.match(m.text('va-form-error'), /Choose the company this support is for\./);
    assert.equal(m.fieldAttr('va-company', 'aria-invalid'), true);
    assert.equal(m.fieldAttr('va-company', 'aria-describedby'), 'va-form-error');
    await m.change('va-company', 'northwind');
    await m.submit('va-log-support');
    assert.match(m.text('va-form-error'), /Describe the support before saving\./);
    assert.equal(m.fieldAttr('va-summary', 'aria-invalid'), true);
    assert.equal(posts, 0, 'nothing is sent until the form is valid');
    await m.change('va-summary', 'Introduce the founder to a pilot customer');
    await m.change('va-hours', '');
    await m.submit('va-log-support');
    assert.equal(posts, 1);
    assert.match(m.text('va-form-error'), /^This did not save\. Your entries are kept\./);
    assert.equal(m.value('va-company'), 'northwind');
    assert.equal(m.value('va-summary'), 'Introduce the founder to a pilot customer');
    assert.match(m.text('button-va-record'), /Try saving again/);
    assert.equal(m.all('metric-open')[0].state, 'ok', 'a failed save leaves the ledger read standing');
  } finally { await m.close(); }
});
