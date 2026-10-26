// D1186 (#3115, part 5 of #2389) — Bank accounts › Cash and History, and
// their states (BNK3–BNK5, BNK8–BNK11): the tiles from one accounts read,
// cash by entity with a day with no snapshot drawn as a gap and never a drop
// to 0, money in and out by month, every unmatched receipt counted, History
// from part 1's read with search, filters and a pinned snapshot, and each
// block failing alone. Mercury is stubbed: every request here is answered by
// a local fixture and nothing leaves the test.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bank_cash_history_d1186.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { BankAccountsPage } from '../src/pages/admin/ConsolePages.jsx';
import { Accounts as FundAdminAccounts } from '../src/pages/admin/fundAdmin/BankingTabs.jsx';
import {
  cashTiles, daysBetween, entityCash, monthlyOf, monthsOf, runsOf, seriesOf, unmatchedTile, failedClaim, AUDIT_REFUSED, timeText,
} from '../src/pages/admin/consoles/bankCashModel.js';
import { countText, queryOf, rowOf, filtered, eventOf, pagesOf } from '../src/pages/admin/consoles/bankHistoryModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0, name: 'Admin', email: 'a@example.com' };

const acct = (uid, entity_key, last_four, cur, avail, registered = true, extra = {}) => ({
  uid, entity_key, kind: 'checking', last_four, nickname: null, registered,
  current: { cents: cur, reason: cur == null ? 'not_recorded' : null }, available: { cents: avail, reason: avail == null ? 'not_recorded' : null },
  balance_read_at: '2026-10-25T08:00:00Z', ...extra,
});
const ACCOUNTS = { ok: true, items: [
  acct('a-h', 'holdings', '4821', 166256018, 165000000),
  acct('a-c', 'holdings', '9012', 321040, null, false),
  acct('a-g', 'gp', '6604', null, null),
  acct('a-f', 'fund', '7310', 5000000, 4990000),
] };
const CONNECTIONS = { entities: [
  { entity_key: 'holdings', connection: { status: 'active' } },
  { entity_key: 'gp', connection: { status: 'active' } },
  { entity_key: 'management', connection: null },
  { entity_key: 'fund', connection: { status: 'active' } },
] };
const pt = (date, cents) => ({ date, current: { cents, reason: cents == null ? 'not_recorded' : null }, available: { cents: null, reason: 'not_recorded' }, as_of: `${date}T08:00:00Z` });
// Five days; the GP account has no snapshot on the 23rd: a gap, never a drop.
const BALANCES = { ok: true, currency: 'USD', range: '30d', from: '2026-10-21', to: '2026-10-25', items: [
  { account_uid: 'a-h', entity_key: 'holdings', registered: true, account_masked: '••••4821', reason: null, points: ['21', '22', '23', '24', '25'].map((d) => pt(`2026-10-${d}`, 100000)) },
  { account_uid: 'a-g', entity_key: 'gp', registered: true, account_masked: '••••6604', reason: null, points: ['21', '22', '24', '25'].map((d) => pt(`2026-10-${d}`, 50000)) },
  { account_uid: 'a-c', entity_key: 'holdings', registered: false, account_masked: '••••9012', reason: null, points: [pt('2026-10-23', 999999)] },
] };
const MONTHLY = { ok: true, currency: 'USD', from: '2026-05-01', to: '2026-10-26', months: 6, items: [
  { entity_key: 'holdings', reason: null, points: [{ month: '2026-09', in_cents: 13000000, out_cents: 9200000, to_date: false }, { month: '2026-10', in_cents: 6000000, out_cents: 4100000, to_date: true }] },
  { entity_key: 'gp', reason: null, points: [{ month: '2026-10', in_cents: 2200000, out_cents: 1500000, to_date: true }] },
  { entity_key: 'management', reason: 'not_recorded', points: [] },
  { entity_key: 'fund', reason: 'not_recorded', points: [] },
] };
const HIST = (rows, total = rows.length, extra = {}) => ({ rows, total, page: 1, per: 25, snapshot: '9.40.1793000000000', ...extra });
const REVEAL = { id: 'reveal:9', source: 'reveal_ledger', kind: 'reveal', action: 'bank_account_revealed', time: '2026-10-21T09:14:00.000Z', actor_name: 'Ada Admin', entity_key: 'holdings', account_masked: '••••4821', context: 'admin_reveal', context_ref: 'Checking the number before the Q4 licence invoice.', detail_unreadable: false };
const ADDED = { id: 'audit:40', source: 'admin_audit', kind: 'bank_account', action: 'bank_account_added', time: '2026-10-12 11:41:00', actor_name: 'Ada Admin', entity_key: 'holdings', account_masked: '••••4821', account_label: 'Operating checking', detail_unreadable: false };
const BROKEN = { id: 'audit:41', source: 'admin_audit', kind: 'bank_account', action: 'bank_account_updated', time: '2026-10-13T10:00:00Z', actor_name: null, entity_key: null, account_masked: null, detail_unreadable: true };

function router(over = {}) {
  return (path) => {
    for (const [re, body] of Object.entries(over)) if (new RegExp(re).test(path)) return typeof body === 'function' ? body(path) : body;
    if (path.startsWith('/admin/mercury/accounts')) return response(ACCOUNTS);
    if (path.startsWith('/admin/mercury/connections')) return response(CONNECTIONS);
    if (path.startsWith('/admin/mercury/balances')) return response(BALANCES);
    if (path.startsWith('/admin/mercury/monthly')) return response(MONTHLY);
    if (path.startsWith('/admin/mercury/transactions')) return response({ ok: true, page: 1, page_size: 50, total: /entity=holdings/.test(path) ? 120 : /entity=gp/.test(path) ? 7 : 0, items: [] });
    if (path.startsWith('/admin/bank-accounts/history')) return response(HIST([REVEAL, ADDED, BROKEN]));
    return response({});
  };
}

async function mounted(url, user, over) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const answer = router(over);
  globalThis.fetch = async (u) => { const p = String(u).replace(/^.*\/api/, ''); requests.push(p); return answer(p); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(BankAccountsPage)))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const byId = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  return {
    requests, settle,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => (id ? byId(id).map(txt).join(' ') : txt(container)).replace(/\s+/g, ' '),
    all: byId,
    async click(id, i = 0) { await act(async () => pr(byId(id)[i]).onClick({ preventDefault() {} })); await settle(); },
    async change(id, value) { await act(async () => pr(byId(id)[0]).onChange({ target: { value } })); await settle(); },
    async submit(id) { await act(async () => pr(byId(id)[0]).onSubmit({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

// ── The model ──────────────────────────────────────────────────────────────

test('a day with no snapshot is a gap for the whole stack, never a drop to 0', () => {
  const s = seriesOf(BALANCES);
  assert.deepEqual(s.days.map((d) => d.date), daysBetween('2026-10-21', '2026-10-25'));
  const gap = s.days.find((d) => d.date === '2026-10-23');
  assert.equal(gap.total, null);
  assert.deepEqual(gap.byEntity, { holdings: null, gp: null });
  assert.equal(s.days.find((d) => d.date === '2026-10-24').total, 150000);
  assert.equal(s.gaps, 1);
  assert.ok(!s.days.some((d) => d.total === 0), 'no day is 0');
  // An account outside the registry is not in the chart, even on the gap day.
  assert.ok(!s.days.some((d) => d.total === 999999 + 100000));
  assert.deepEqual(runsOf(s.days).map((r) => [r.gap, r.start, r.end]), [[false, 0, 1], [true, 2, 2], [false, 3, 4]]);
  assert.deepEqual(s.entities, ['holdings', 'gp']);
  assert.deepEqual(s.missing, ['management', 'fund']);
  // A snapshot whose Current is null is a gap too; a recorded zero is a zero.
  const nullCur = seriesOf({ ...BALANCES, items: [{ ...BALANCES.items[0], points: [pt('2026-10-21', null), pt('2026-10-22', 0)] }], to: '2026-10-22' });
  assert.equal(nullCur.days[0].total, null);
  assert.equal(nullCur.days[1].total, 0);
  // Nothing stored in the range is empty, not a flat line at 0.
  assert.equal(seriesOf({ ...BALANCES, items: [] }).empty, true);
});

test('the tiles: cash across entities adds Current over the registry\'s accounts, an account without a balance is named, never 0', () => {
  const [cash, avail, , without] = cashTiles({ status: 'ready', data: ACCOUNTS }, { status: 'ready', byEntity: {} });
  assert.equal(cash.value, '$1,712,560.18');
  assert.match(cash.note, /Registered accounts, 2 of 3 read/);
  assert.match(cash.note, /as of 25 Oct 2026, 08:00 UTC/);
  assert.equal(avail.value, '$1,699,900.00');
  assert.match(avail.note, /Excludes pending debits · 2 of 3 accounts/);
  assert.equal(without.value, '1');
  assert.match(without.note, /GP ••••6604: Mercury sent no balance/);
  const none = cashTiles({ status: 'ready', data: { items: [acct('x', 'gp', '1111', null, null)] } }, null);
  assert.equal(none[0].value, 'Not recorded');
  assert.ok(none[0].missing);
  const failed = cashTiles({ status: 'unreadable' }, null);
  assert.equal(failed[0].value, 'Unreadable');
  assert.equal(cashTiles({ status: 'loading' }, null)[0].loading, true);
});

test('Fund I\'s figure is Fund admin\'s: both come from the same accounts read', () => {
  assert.equal(entityCash(ACCOUNTS.items, 'fund'), 5000000);
  // An entity with an account that has no Current has no figure, never a partial one.
  assert.equal(entityCash(ACCOUNTS.items, 'gp'), null);
  assert.equal(entityCash(ACCOUNTS.items, 'management'), null);
  // The card account outside the registry is not Holdings' cash.
  assert.equal(entityCash(ACCOUNTS.items, 'holdings'), 166256018);
});

test('every unmatched receipt is counted: each connected entity\'s total, not a sample; a failed entity makes it Unreadable', () => {
  const ready = unmatchedTile({ status: 'ready', byEntity: { holdings: { status: 'ready', total: 120 }, gp: { status: 'ready', total: 7 }, management: { status: 'unconnected' }, fund: { status: 'ready', total: 0 } } });
  assert.equal(ready.value, '127');
  assert.match(ready.note, /Holdings 120 · Management not connected · GP 7 · Fund I 0/);
  const partial = unmatchedTile({ status: 'ready', byEntity: { holdings: { status: 'ready', total: 120 }, gp: { status: 'unreadable' } } });
  assert.equal(partial.value, 'Unreadable');
  assert.match(partial.note, /GP could not be read/);
  assert.equal(unmatchedTile({ status: 'ready', byEntity: {} }).value, 'Not recorded');
  assert.equal(unmatchedTile({ status: 'unreadable' }).value, 'Unreadable');
});

test('money in and out: six months, a month with no posted line is Not recorded, All names the entities without it', () => {
  assert.deepEqual(monthsOf(MONTHLY), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const all = monthlyOf(MONTHLY, 'all');
  assert.equal(all.months[0].in_cents, null);
  const oct = all.months[5];
  assert.equal(oct.in_cents, 8200000);
  assert.equal(oct.out_cents, 5600000);
  assert.equal(oct.to_date, true);
  const sep = all.months[4];
  assert.equal(sep.in_cents, 13000000);
  assert.deepEqual(sep.without, ['gp', 'management', 'fund']);
  const gp = monthlyOf(MONTHLY, 'gp');
  assert.equal(gp.months[4].in_cents, null);
  assert.deepEqual(gp.months[5].without, []);
  assert.equal(monthlyOf(MONTHLY, 'fund').empty, true);
});

test('History rows: masked, a reveal opens to its reason, an unreadable detail says so, a missing name says so', () => {
  const r = rowOf(REVEAL);
  assert.equal(r.event, 'Reveal');
  assert.equal(r.account, '••••4821');
  assert.equal(r.reason, 'Checking the number before the Q4 licence invoice.');
  assert.equal(r.when, '21 Oct 2026, 09:14 UTC');
  const lp = rowOf({ ...REVEAL, context: 'capital_call_line', context_ref: '12' });
  assert.equal(lp.reason, null);
  assert.match(lp.detail, /their own capital-call line \(line #12\)/);
  assert.equal(rowOf({ ...REVEAL, context_ref: null }).detail, 'No reason recorded.');
  const b = rowOf(BROKEN);
  assert.equal(b.event, 'Changed');
  assert.match(b.detail, /could not be read/);
  assert.equal(b.by, 'Name not recorded');
  assert.equal(b.entity, 'Not recorded');
  assert.equal(b.account, '—');
  assert.equal(rowOf(ADDED).when, '12 Oct 2026, 11:41 UTC');
  assert.equal(eventOf({ action: 'mercury_token_replaced' }), 'Token replaced');
  // Only the masked ending is ever drawn, whatever else a row carries.
  assert.equal(rowOf({ ...ADDED, account_masked: null, account_uid: 'f'.repeat(32) }).account, '—');
});

test('History query: page 1 pins no snapshot, later pages send it; filters and counts', () => {
  assert.equal(queryOf({ q: ' 4821 ', kind: 'reveal', entity: '', range: 'all' }, 1, 'snap').snapshot, null);
  const q2 = queryOf({ q: '', kind: '', entity: 'gp', range: '30d' }, 2, '9.40.1');
  assert.equal(q2.snapshot, '9.40.1');
  assert.equal(q2.range, '30d');
  assert.equal(q2.entity, 'gp');
  assert.equal(queryOf({ q: 'x'.repeat(200) }, 1).q.length, 120);
  assert.equal(queryOf({ range: 'all' }, 1).range, null);
  assert.equal(filtered({ q: '', kind: '', entity: '', range: 'all' }), false);
  assert.equal(filtered({ range: '7d' }), true);
  assert.equal(countText({ total: 61, page: 3, per: 25 }), '51–61 of 61');
  assert.equal(countText({ total: 0 }), '0 events');
  assert.equal(countText({}), 'Count not recorded');
  assert.equal(pagesOf({ total: 61, per: 25 }), 3);
});

test('a 503 audit refusal is worded as nothing read', () => {
  assert.equal(failedClaim({ status: 503, data: { code: 'audit_unavailable' } }, 'x'), AUDIT_REFUSED);
  assert.equal(failedClaim({ status: 503, data: { code: 'balances_unreadable' } }, 'x'), 'x');
  assert.equal(failedClaim({ status: 500 }, 'x'), 'x');
  assert.equal(timeText('nope'), null);
});

// ── Mounted ────────────────────────────────────────────────────────────────

test('Cash mounted: tiles, the gap drawn as Not recorded, monthly bars, balances, every Mercury read a GET of the stored reads', async () => {
  const v = await mounted('/admin/platform/bank-accounts/cash', SUPER);
  try {
    assert.ok(!v.ids().some((id) => id.startsWith('bank-wait-')), 'no "Not read here yet" block is left');
    assert.match(v.text('bank-cash-tile-cash-across-entities'), /\$1,712,560\.18/);
    assert.match(v.text('bank-cash-tile-unmatched-receipts'), /127/);
    assert.match(v.text('bank-cash-tile-accounts-without-a-balance'), /GP ••••6604/);
    assert.equal(v.all('bank-cash-gap').length, 1);
    assert.match(v.text('bank-cash-series'), /Not recorded/);
    assert.match(v.text('bank-cash-series-foot'), /1 day is not recorded/);
    assert.equal(v.all('bank-cash-month').length, 2);
    assert.equal(v.all('bank-cash-month-nr').length, 4);
    // The accounts read is made once and feeds the tiles, the legend and the Balances table.
    assert.equal(v.requests.filter((u) => u.startsWith('/admin/mercury/accounts')).length, 1);
    assert.match(v.text('banking-accounts'), /Balances/);
    assert.ok(v.ids().includes('account-a-f'), 'the Balances table draws the shared read\'s rows');
    assert.match(v.text('bank-cash-legend-fund'), /\$50,000\.00/);
    // Unmatched: one total read per connected entity, never for the one not connected.
    const tx = v.requests.filter((u) => u.startsWith('/admin/mercury/transactions'));
    assert.equal(tx.length, 3);
    assert.ok(tx.every((u) => /match=none/.test(u) && /direction=credit/.test(u)));
    assert.ok(!tx.some((u) => /entity=management/.test(u)));
    assert.ok(v.requests.some((u) => u === '/admin/mercury/balances?range=90d'));
    assert.ok(!v.requests.some((u) => u.startsWith('/admin/bank-accounts')), 'Cash makes no registry or history read');
  } finally { await v.close(); }
});

test('Cash: a range reads again, the entity chips read nothing again, Table shows the gap as Not recorded', async () => {
  const v = await mounted('/admin/platform/bank-accounts/cash', SUPER);
  try {
    await v.click('bank-cash-range-30d');
    assert.ok(v.requests.includes('/admin/mercury/balances?range=30d'));
    const monthly = v.requests.filter((u) => u.startsWith('/admin/mercury/monthly')).length;
    await v.click('bank-cash-monthly-entity-gp');
    assert.equal(v.requests.filter((u) => u.startsWith('/admin/mercury/monthly')).length, monthly);
    assert.equal(v.all('bank-cash-month').length, 1);
    await v.click('bank-cash-series-view-table');
    assert.match(v.text('bank-cash-series-table'), /23 Oct Not recorded Not recorded Not recorded/);
  } finally { await v.close(); }
});

test('Cash: each block fails alone; an audit refusal says nothing was read', async () => {
  const v = await mounted('/admin/platform/bank-accounts/cash', SUPER, {
    '^/admin/mercury/balances': () => response({ code: 'audit_unavailable' }, 503),
    '^/admin/mercury/monthly': () => response({ code: 'monthly_unreadable' }, 503),
  });
  try {
    assert.match(v.text('bank-cash-series'), /could not be read\. Nothing was read, because its audit row could not be written\./);
    assert.match(v.text('bank-cash-monthly'), /Money in and out could not be read\. This is not a claim that no money moved\./);
    assert.match(v.text('bank-cash-tile-cash-across-entities'), /\$1,712,560\.18/, 'the tiles still stand');
    assert.ok(v.ids().includes('banking-accounts'));
  } finally { await v.close(); }
  const w = await mounted('/admin/platform/bank-accounts/cash', SUPER, { '^/admin/mercury/accounts': () => response({ code: 'x' }, 500) });
  try {
    assert.match(w.text('bank-cash-tile-cash-across-entities'), /Unreadable/);
    assert.ok(!/\$0\.00/.test(w.text('bank-cash-tiles')));
    assert.ok(w.ids().includes('bank-cash-tiles-failed'));
    assert.ok(w.all('bank-cash-area').length > 0, 'the chart still draws');
  } finally { await w.close(); }
});

test('Fund admin\'s Accounts table and Cash\'s legend show the same Fund I figure', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const api = { accounts: async () => ACCOUNTS };
  await act(async () => root.render(h(MemoryRouter, null, h(FundAdminAccounts, { apis: { mercury: api } }))));
  await act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const fundAdmin = txt(container);
  await act(async () => root.unmount()); restore();
  assert.match(fundAdmin, /\$50,000\.00/);
  const v = await mounted('/admin/platform/bank-accounts/cash', SUPER);
  try { assert.match(v.text('bank-cash-legend-fund'), /\$50,000\.00/); } finally { await v.close(); }
});

test('History mounted: masked rows, a reveal opens to its reason, search and filters read again from page 1', async () => {
  const v = await mounted('/admin/platform/bank-accounts/history', SUPER);
  try {
    assert.equal(v.all('bank-history-row').length, 3);
    assert.match(v.text('bank-history-count'), /1–3 of 3/);
    assert.ok(!/\b\d{5,}\b/.test(v.text('bank-history-table')), 'no long number in the table');
    assert.ok(!v.ids().includes('bank-history-reason'));
    await v.click('bank-history-reason-toggle');
    assert.match(v.text('bank-history-reason'), /‘Checking the number before the Q4 licence invoice\.’ The number was shown for 30 seconds\./);
    await v.change('bank-history-q', '4821');
    await v.submit('bank-history-filters');
    assert.ok(v.requests.some((u) => /history\?q=4821&page=1&per=25$/.test(u)), v.requests.join('\n'));
    await v.change('bank-history-kind', 'reveal');
    assert.ok(v.requests.some((u) => /q=4821&kind=reveal&page=1/.test(u)));
    assert.ok(v.requests.filter((u) => u.startsWith('/admin/bank-accounts/history')).every((u) => !/snapshot=/.test(u)));
  } finally { await v.close(); }
});

test('History pages keep the first page\'s snapshot', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...ADDED, id: `audit:${i}` }));
  const v = await mounted('/admin/platform/bank-accounts/history', SUPER, { '^/admin/bank-accounts/history': (p) => response(HIST(many, 30, { page: /page=2/.test(p) ? 2 : 1 })) });
  try {
    await v.click('bank-history-next');
    assert.ok(v.requests.some((u) => /page=2&per=25&snapshot=9\.40\.1793000000000/.test(u)), v.requests.join('\n'));
    assert.match(v.text('bank-history-count'), /26–30 of 30/);
    // A filter starts again from page 1, without the old snapshot.
    await v.change('bank-history-entity', 'gp');
    assert.ok(v.requests.at(-1).endsWith('entity=gp&page=1&per=25'), v.requests.at(-1));
  } finally { await v.close(); }
});

test('History states: empty (BNK8b), nothing matching, unreadable and the audit refusal', async () => {
  const empty = await mounted('/admin/platform/bank-accounts/history', SUPER, { '^/admin/bank-accounts/history': () => response(HIST([], 0)) });
  try { assert.match(empty.text('bank-history-empty'), /Nothing has been revealed or changed yet\. Every reveal and change will be listed here\./); } finally { await empty.close(); }
  let n = 0;
  const none = await mounted('/admin/platform/bank-accounts/history', SUPER, { '^/admin/bank-accounts/history': () => response(n++ ? HIST([], 0) : HIST([REVEAL])) });
  try {
    await none.change('bank-history-entity', 'fund');
    assert.ok(none.ids().includes('bank-history-no-match'));
    assert.ok(!none.ids().includes('bank-history-empty'), 'a filtered empty is not "nothing has happened"');
  } finally { await none.close(); }
  const audit = await mounted('/admin/platform/bank-accounts/history', SUPER, { '^/admin/bank-accounts/history': () => response({ code: 'audit_unavailable' }, 503) });
  try { assert.match(audit.text('bank-history-unreadable'), /The history could not be read\. Nothing was read, because its audit row could not be written\./); } finally { await audit.close(); }
});

test('an Admin gets BNK11a\'s card on Cash and History and nothing is read', async () => {
  for (const tab of ['cash', 'history']) {
    const v = await mounted(`/admin/platform/bank-accounts/${tab}`, ADMIN);
    try {
      assert.match(v.text('bank-admin-line'), /This page belongs to the Super Admin/);
      assert.deepEqual(v.requests.filter((u) => u.startsWith('/admin/')), [], tab);
    } finally { await v.close(); }
  }
});

test('the source: GET reads only, no browser pop-up, no raw colour, no zero for a missing value', () => {
  for (const f of ['BankCashTab.jsx', 'BankHistoryTab.jsx', 'bankCashModel.js', 'bankHistoryModel.js']) {
    const src = read(`frontend/src/pages/admin/consoles/${f}`);
    assert.ok(!/\balert\(|\bconfirm\(|window\.prompt/.test(src), f);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/(^|[\s(,])#\d{4}\b/g, '')), `${f} has a hex colour`);
    assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(src), `${f} writes`);
    assert.ok(!/['"]\$0(\.00)?['"]/.test(src), f);
  }
});
