/**
 * D4817 part 7 (#5311, canvas PF-07): the two money writes an admin records
 * against a company's position — a valuation mark and a distribution — taken
 * Prepare → Review → Confirm → Receipt. The real admin positions page
 * (`PortfolioPositionsPage`, the Cap Table tab) is mounted with the real
 * `WriteFlow` against a stubbed Worker; plus the pure model.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_write_flow_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - `validate` dropping the real-calendar check (2026-02-30 accepted) → tests 2 and 6;
 *   - the field error not tied to its input (`aria-describedby` dropped) → test 2;
 *   - the flow saving without reading the company again first → tests 1 and 4;
 *   - `changedSince` always false (no conflict) → test 4;
 *   - a failed save clearing the draft (`setValues(initial)` in the catch) → test 3;
 *   - an unanswered save worded as "Nothing was recorded" → test 3;
 *   - a 400 naming a field not taken back to that field (`fieldOfError` → null) → test 2;
 *   - the receipt drawing the draft instead of the Worker's stored record → test 1;
 *   - `markAfter` taking an earlier-dated mark as the new carrying value → tests 4 and 6;
 *   - Cancel on a typed draft closing without asking → test 5;
 *   - the book's NAV/TVPI projected rather than said to be not projected → test 1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PortfolioPositionsPage from '../src/pages/PortfolioPositionsPage.jsx';
import {
  NOT_PROJECTED, baseOf, failureOf, fieldOfError, isIsoDate, markAfter, parseMoney, payloadOf, receiptOf, reviewOf, validate,
} from '../src/pages/portfolio/writeFlowModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ------------------------------------------------------------- the book */

const PROJECT = { id: 1, uid: 'northwind', name: 'Northwind Labs' };
const DETAIL = {
  project: PROJECT,
  rounds: [{ uid: 'r1', round_name: 'Seed', invested_amount: 1500000, ownership_pct: 6.2 }],
  cap_table_snapshot: [],
  marks: [{ uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price', event: 'Priced round' }],
  distributions: [{ uid: 'd1', distribution_date: '2026-05-01', amount: 900000, kind: 'secondary' }],
};
const MOVED = { ...DETAIL, marks: [{ uid: 'm2', as_of_date: '2026-09-30', fmv: 2250000, basis: 'gp_estimate' }, ...DETAIL.marks] };
const LIST = { items: [{ project_id: 1, project: PROJECT, total_invested: 1500000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed' }] };
const STORED_MARK = {
  id: 41, uid: 'mk-7f3a', fund_id: null, project_id: 1, as_of_date: '2026-09-30', fmv: 2100000, post_money: null,
  event: 'Down round', basis: 'gp_estimate', source: 'Q3 board pack', note: null, created_by: 1, created_at: '2026-11-14T14:44:09.120Z',
};
const STORED_DIST = {
  id: 9, uid: 'ds-31c0', fund_id: null, project_id: 1, distribution_date: '2026-11-05', amount: 150000, kind: 'exit',
  note: 'Partial exit', created_by: 1, created_at: '2026-11-14T15:02:00Z',
};

/** The Worker: `detail` answers each company read in turn (the last repeats); `post` answers the write. */
function worker({ details = [DETAIL], post = () => json(STORED_MARK, 201), role = 'admin' } = {}) {
  let read = 0;
  return ({ path, method, body }) => {
    if (path === '/api/auth/me') return json({ id: 1, role, name: 'Ada' });
    if (method === 'GET' && path === '/api/positions') return json(LIST);
    if (method === 'GET' && path === '/api/positions/northwind') {
      const d = details[Math.min(read, details.length - 1)];
      read += 1;
      return typeof d === 'function' ? d() : json(d);
    }
    if (method === 'POST') return post({ path, body });
    return json({});
  };
}

async function mount(answer, { role = 'admin' } = {}) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, method, body });
    return answer({ path: u.pathname, method, body }) ?? json({});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role, name: 'Ada' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(AuthProvider, null, h(PortfolioPositionsPage, { embedded: true })))));
  await settle();
  const need = (node, what) => { if (!node) throw new Error(`no ${what}`); return node; };
  const fire = async (fn) => { await act(async () => { fn(); }); await settle(); };
  const api = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    has: (id) => Boolean(byTestId(id)),
    node: byTestId,
    prop: (id, name) => props(need(byTestId(id), id))[name],
    text: (id) => (id ? (byTestId(id) ? squash(textOf(byTestId(id))) : null) : squash(textOf(box))),
    step: (kind) => props(need(byTestId(`write-flow-${kind}`), 'flow'))['data-step'],
    click: (id) => fire(() => props(need(byTestId(id), id)).onClick({ preventDefault() {}, stopPropagation() {} })),
    clickText: (label) => fire(() => props(need(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label)).onClick({ preventDefault() {} })),
    type: (id, value) => fire(() => props(need(byTestId(id), id)).onChange({ target: { value } })),
    submit: (id) => fire(() => props(need(byTestId(id), id)).onSubmit({ preventDefault() {} })),
    value: (id) => props(need(byTestId(id), id)).value,
    closeSheet: () => fire(() => props(need(byTestId('portfolio-position-sheet-close'), 'the sheet’s close')).onClick()),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
  return api;
}

async function openMark(page) {
  await page.clickText('View dilution');
  await page.click('button-mark-open');
  await page.type('input-mark-as_of_date', '2026-09-30');
  await page.type('input-mark-fmv', '2,100,000');
  await page.type('input-mark-event', 'Down round');
}

/* ------------------------------------------------------------- the steps */

test('a mark goes Prepare → Review → Confirm → Receipt, naming the company, and the receipt is the stored record', async () => {
  const page = await mount(worker({ details: [DETAIL, DETAIL, MOVED] }));
  try {
    await openMark(page);
    assert.equal(page.step('mark'), 'prepare');
    assert.match(page.text('write-flow-company'), /Company · Northwind Labs · 1 round · invested \$1,500,000/);
    assert.match(page.text('write-flow-mark'), /Prepare.*Review.*Confirm.*Receipt/);
    assert.match(page.text('write-flow-mark'), /Draft · not saved/);

    await page.submit('form-mark');
    assert.equal(page.step('mark'), 'review');
    assert.match(page.text('write-flow-company'), /Northwind Labs/);
    const written = page.text('write-flow-written');
    assert.match(written, /Company Northwind Labs/);
    assert.match(written, /portfolio_marks · No fund named: recorded at firm level/);
    assert.match(written, /As-of date 30 Sep 2026/);
    assert.match(written, /Fair market value of the position \$2,100,000/);
    assert.match(written, /Basis GP estimate/);
    assert.match(written, /Event Down round/);
    assert.match(written, /Source Not recorded · left blank/);
    assert.equal(page.text('effect-fmv'), 'Carrying value $2,400,000 · mark of 31 Mar 2026 $2,100,000 · mark of 30 Sep 2026');
    assert.equal(page.text('effect-moic'), 'MOIC (gross) 1.60× 1.40×');
    assert.match(page.text('effect-book'), new RegExp(`${NOT_PROJECTED} ${NOT_PROJECTED}.*does not estimate it`), 'the book must not be projected');
    assert.equal(page.posts().length, 0, 'nothing is written at Review');

    await page.click('write-flow-continue');
    assert.equal(page.step('mark'), 'confirm');
    assert.equal(page.text('write-flow-confirm'), 'Record $2,100,000 mark for Northwind Labs');
    assert.match(page.text('write-flow-confirm-note'), /audit log/);
    assert.equal(page.posts().length, 0, 'nothing is written before the act');

    const before = page.calls.length;
    await page.click('write-flow-confirm');
    const after = page.calls.slice(before);
    const reread = after.findIndex((c) => c.method === 'GET' && c.path === '/api/positions/northwind');
    const post = after.findIndex((c) => c.method === 'POST');
    assert.ok(reread >= 0 && reread < post, 'the company is read again before the write');
    assert.equal(after[post].path, '/api/positions/northwind/marks');
    assert.deepEqual(after[post].body, { fmv: 2100000, as_of_date: '2026-09-30', basis: 'gp_estimate', event: 'Down round' });

    assert.equal(page.step('mark'), 'receipt');
    assert.match(page.text('write-flow-receipt'), /Saved by the Worker at 14 Nov 2026, 14:44:09 UTC/);
    assert.equal(page.text('receipt-uid'), 'mk-7f3a');
    assert.equal(page.text('receipt-fmv'), '$2,100,000');
    assert.equal(page.text('receipt-as_of_date'), '30 Sep 2026');
    // The receipt reads the Worker's stored row, not the draft: the stub's row
    // carries a source the draft left blank.
    assert.equal(page.text('receipt-source'), 'Q3 board pack');
    assert.equal(page.text('receipt-note'), 'Not recorded');
    assert.match(page.text('receipt-revision'), /^Not recorded · the Worker keeps no revision/);
    assert.match(page.text('write-flow-receipt'), /portfolio\.mark_recorded/);
    assert.ok(after.filter((c) => c.method === 'GET' && c.path === '/api/positions/northwind').length >= 2, 'the histories are read back after the save');
    await page.click('write-flow-done');
    assert.equal(page.has('write-flow-mark'), false);
    assert.equal(page.has('button-mark-open'), true);
  } finally { await page.close(); }
});

test('Prepare: each error is labelled and tied to its field, nothing is sent, and a Worker 400 returns to the field it names', async () => {
  const page = await mount(worker({ post: () => json({ detail: 'fmv is required and must be >= 0' }, 400) }));
  try {
    await page.clickText('View dilution');
    await page.click('button-mark-open');
    await page.type('input-mark-as_of_date', '2026-02-30');
    await page.type('input-mark-fmv', 'two million');
    await page.submit('form-mark');
    assert.equal(page.step('mark'), 'prepare');
    assert.match(page.text('write-flow-errors'), /Check 2 fields/);
    assert.equal(page.text('error-mark-as_of_date'), 'Enter a real date as YYYY-MM-DD.');
    assert.equal(page.text('error-mark-fmv'), 'Enter an amount in US dollars, like 2,100,000.');
    assert.equal(page.prop('input-mark-fmv', 'aria-invalid'), 'true');
    const fmvId = page.prop('input-mark-fmv', 'id');
    assert.equal(page.prop('input-mark-fmv', 'aria-describedby'), `${fmvId}-err`);
    assert.equal(page.prop('error-mark-fmv', 'id'), `${fmvId}-err`);
    assert.equal(page.prop('input-mark-event', 'aria-invalid'), undefined);
    assert.equal(page.posts().length, 0);

    // Fixing a field clears its own error only.
    await page.type('input-mark-fmv', '0');
    assert.equal(page.has('error-mark-fmv'), false);
    assert.equal(page.has('error-mark-as_of_date'), true);
    await page.type('input-mark-as_of_date', '2026-09-30');
    await page.submit('form-mark');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    // The Worker refused the value: back at Prepare, on that field, with its sentence.
    assert.equal(page.step('mark'), 'prepare');
    assert.equal(page.text('error-mark-fmv'), 'fmv is required and must be >= 0');
    assert.match(page.text('write-flow-errors'), /The Worker refused the mark\. Nothing was recorded; your entries are kept\./);
    assert.equal(page.value('input-mark-fmv'), '0');
    assert.equal(page.value('input-mark-as_of_date'), '2026-09-30');
  } finally { await page.close(); }

  // A distribution's amount must be more than $0.
  const dist = await mount(worker());
  try {
    await dist.clickText('View dilution');
    await dist.click('button-dist-open');
    await dist.type('input-distribution-distribution_date', '');
    await dist.type('input-distribution-amount', '0');
    await dist.submit('form-distribution');
    assert.equal(dist.text('error-distribution-amount'), 'The amount must be more than $0.');
    assert.equal(dist.text('error-distribution-distribution_date'), 'Enter the date received.');
  } finally { await dist.close(); }
});

test('a failed distribution save keeps every entry and shows the Worker’s error; no answer is not called "nothing recorded"', async () => {
  let attempt = 0;
  const page = await mount(worker({
    post: () => {
      attempt += 1;
      if (attempt === 1) return json({ detail: 'The database is unavailable.' }, 503);
      if (attempt === 2) throw new TypeError('Failed to fetch');
      return json(STORED_DIST, 201);
    },
  }));
  try {
    await page.clickText('View dilution');
    await page.click('button-dist-open');
    await page.type('input-distribution-distribution_date', '2026-11-05');
    await page.type('input-distribution-amount', '150,000');
    await page.type('input-distribution-note', 'Partial exit');
    await page.submit('form-distribution');
    assert.equal(page.text('effect-distributed'), 'Distributed from this company $900,000 $1,050,000');
    assert.equal(page.text('effect-dpi'), 'DPI for this company 0.60× 0.70×');
    await page.click('write-flow-continue');
    assert.equal(page.text('write-flow-confirm'), 'Record $150,000 distribution for Northwind Labs');

    await page.click('write-flow-confirm');
    assert.equal(page.step('distribution'), 'confirm');
    assert.match(page.text('write-flow-failure'), /Couldn’t save\.|Couldn't save\./);
    assert.match(page.text('write-flow-failure'), /The database is unavailable\. Nothing was recorded; your entries are kept\./);
    assert.match(page.text('write-flow-confirm'), /^Try again: Record \$150,000 distribution for Northwind Labs$/);

    // Back to Prepare: every entry is still there.
    await page.click('write-flow-back');
    await page.click('write-flow-back');
    assert.equal(page.step('distribution'), 'prepare');
    assert.equal(page.value('input-distribution-amount'), '150,000');
    assert.equal(page.value('input-distribution-distribution_date'), '2026-11-05');
    assert.equal(page.value('input-distribution-note'), 'Partial exit');
    assert.equal(page.value('input-distribution-kind'), 'exit');

    await page.submit('form-distribution');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    const failure = page.text('write-flow-failure');
    assert.match(failure, /No answer from the Worker\. Failed to fetch/);
    assert.match(failure, /Whether the distribution was recorded is not known/);
    assert.doesNotMatch(failure, /Nothing was recorded/);

    await page.click('write-flow-confirm');
    assert.equal(page.step('distribution'), 'receipt');
    assert.equal(page.text('receipt-uid'), 'ds-31c0');
    assert.equal(page.text('receipt-amount'), '$150,000');
    assert.equal(page.text('receipt-kind'), 'Exit');
    assert.equal(page.text('receipt-note'), 'Partial exit');
    assert.match(page.text('write-flow-receipt'), /Saved by the Worker at 14 Nov 2026, 15:02:00 UTC/);
    assert.equal(page.posts().length, 3);
    assert.deepEqual(page.posts()[2].body, { amount: 150000, distribution_date: '2026-11-05', kind: 'exit', note: 'Partial exit' });
  } finally { await page.close(); }
});

test('a conflict re-reads: nothing is sent, the draft is kept, and Review measures it against the new mark', async () => {
  // The company read at open, then again at Confirm, where a mark has landed meanwhile.
  const page = await mount(worker({ details: [DETAIL, MOVED] }));
  try {
    await openMark(page);
    await page.submit('form-mark');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    assert.equal(page.step('mark'), 'conflict');
    assert.equal(page.posts().length, 0, 'a conflict sends nothing');
    assert.match(page.text('write-flow-conflict'), /Not saved\. Your draft is kept\./);
    assert.equal(page.text('conflict-row'), 'Latest mark 31 Mar 2026 · $2,400,000 30 Sep 2026 · $2,250,000 30 Sep 2026 · $2,100,000');
    assert.match(page.text('write-flow-company'), /Northwind Labs/);

    await page.click('write-flow-review-again');
    assert.equal(page.step('mark'), 'review');
    assert.match(page.text('effect-fmv'), /^Carrying value \$2,250,000 · mark of 30 Sep 2026 Not determined A mark is already recorded for 30 Sep 2026/);
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    assert.equal(page.step('mark'), 'receipt', 'saved once the read matches what was reviewed');
    assert.equal(page.posts().length, 1);
  } finally { await page.close(); }

  // A 409 from the Worker re-reads too, and shows what is there now.
  let posted = 0;
  const conflicted = await mount(worker({ details: [DETAIL, DETAIL, MOVED], post: () => { posted += 1; return json({ detail: 'Changed meanwhile' }, 409); } }));
  try {
    await openMark(conflicted);
    await conflicted.submit('form-mark');
    await conflicted.click('write-flow-continue');
    await conflicted.click('write-flow-confirm');
    assert.equal(posted, 1);
    assert.equal(conflicted.step('mark'), 'conflict');
    assert.match(conflicted.text('conflict-row'), /30 Sep 2026 · \$2,250,000/);
    await conflicted.click('write-flow-discard-draft');
    assert.equal(conflicted.has('write-flow-mark'), false);
  } finally { await conflicted.close(); }

  // An earlier-dated draft is recorded into the history; the carrying value stays.
  const earlier = await mount(worker());
  try {
    await earlier.clickText('View dilution');
    await earlier.click('button-mark-open');
    await earlier.type('input-mark-as_of_date', '2025-12-31');
    await earlier.type('input-mark-fmv', '1000000');
    await earlier.submit('form-mark');
    assert.match(earlier.text('effect-fmv'), /\$2,400,000 · unchanged The mark of 31 Mar 2026 is later/);
    assert.equal(earlier.text('effect-moic'), 'MOIC (gross) 1.60× 1.60×');
  } finally { await earlier.close(); }
});

test('a typed draft asks before it is discarded, from Cancel and from closing the sheet; an investor sees no write', async () => {
  const page = await mount(worker());
  try {
    await openMark(page);
    await page.click('write-flow-cancel');
    assert.equal(page.has('write-flow-mark'), true, 'Cancel closed a typed draft without asking');
    assert.match(page.text('write-flow-discard'), /Discard this draft mark ?\?/);
    await page.click('write-flow-keep');
    assert.equal(page.value('input-mark-fmv'), '2,100,000');
    await page.closeSheet();
    assert.equal(page.has('portfolio-position-sheet'), true, 'the sheet closed over a typed draft');
    assert.equal(page.has('write-flow-discard'), true);
    await page.click('write-flow-discard-yes');
    assert.equal(page.has('write-flow-mark'), false);
    // An untouched draft closes without a question.
    await page.click('button-dist-open');
    await page.click('write-flow-cancel');
    assert.equal(page.has('write-flow-distribution'), false);
    // And closing the sheet over an untouched draft closes both.
    await page.click('button-dist-open');
    await page.closeSheet();
    assert.equal(page.has('portfolio-position-sheet'), false);
  } finally { await page.close(); }

  const investor = await mount(worker({ role: 'investor' }), { role: 'investor' });
  try {
    await investor.clickText('View dilution');
    assert.equal(investor.has('button-mark-open'), false);
    assert.equal(investor.has('button-dist-open'), false);
  } finally { await investor.close(); }
});

/* ------------------------------------------------------------- the model */

test('the model: parsing, validation, payload, the Worker’s field, failures and an absent receipt', () => {
  assert.equal(parseMoney('$2,100,000'), 2100000);
  assert.equal(parseMoney('12.5'), 12.5);
  assert.equal(parseMoney('-5'), null);
  assert.equal(parseMoney('1e6'), null);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.deepEqual(validate('mark', { as_of_date: '2026-09-30', fmv: '0', basis: 'gp_estimate', event: 'x'.repeat(121) }), {
    event: 'Keep this to 120 characters (now 121).',
  });
  assert.deepEqual(Object.keys(validate('mark', { as_of_date: '', fmv: '', basis: 'nope' })).sort(), ['as_of_date', 'basis', 'fmv']);
  assert.deepEqual(payloadOf('mark', { as_of_date: '2026-09-30', fmv: '$1,000', basis: 'cost', event: ' ', source: 'Board', note: '' }),
    { fmv: 1000, as_of_date: '2026-09-30', basis: 'cost', source: 'Board' });
  assert.equal(fieldOfError('distribution', 'amount is required and must be > 0'), 'amount');
  assert.equal(fieldOfError('mark', 'basis must be one of: cost'), 'basis');
  assert.equal(fieldOfError('mark', 'Project not found'), null);
  assert.deepEqual(failureOf({ status: 409, message: 'x' }).kind, 'conflict');
  assert.deepEqual(failureOf({ status: 500, message: '' }), { kind: 'refused', status: 500, message: 'No reason was given.' });
  assert.equal(failureOf(new TypeError('Failed to fetch')).kind, 'unknown');

  // Unmarked: carried at cost, said so; no rounds: no MOIC, with the reason.
  const unmarked = baseOf({ project: PROJECT, rounds: [{ invested_amount: 500 }], marks: [], distributions: [] });
  const r1 = reviewOf('mark', { as_of_date: '2026-09-30', fmv: '750', basis: 'gp_estimate' }, unmarked);
  assert.equal(r1.effect[0].before, '$500 · no mark, carried at cost');
  assert.equal(r1.effect[1].after, '1.50×');
  const empty = baseOf({ project: PROJECT, rounds: [], marks: [], distributions: [] });
  const r2 = reviewOf('distribution', { distribution_date: '2026-11-05', amount: '10', kind: 'exit' }, empty);
  assert.equal(r2.effect[1].before, 'Not recorded · no invested amount recorded');
  assert.equal(r2.effect[0].before, '$0', 'a measured zero of distributions stays $0');
  assert.equal(markAfter(baseOf(DETAIL), { as_of_date: '2026-01-01', fmv: '1' }).value, 2400000);

  const rows = Object.fromEntries(receiptOf('mark', null).map((r) => [r.key, r.value]));
  assert.equal(rows.uid, 'Not recorded');
  assert.equal(rows.fmv, 'Not recorded');
  assert.equal(rows.created_at, 'Not recorded');
});
