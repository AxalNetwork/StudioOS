// D4812 (#4812, board FA-01) — Fund administration v2's Overview, attention
// first: Needs attention, Fund position, Funds, Recent activity, and Banking &
// entities folded to one line when nothing is connected; the one fund-scope
// control; and the three money states kept apart ($0, Not recorded, Unreadable).
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_overview_v2_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  activityRow, activityTime, attentionItems, fundPosition, healthRows, workspaceOf,
} from '../src/pages/admin/fundAdmin/workspaceModel.js';
import { fundAdminApi } from '../src/lib/api/fundAdmin.js';

const h = React.createElement;
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };

const ENTITY = (key, name, connected = false) => ({
  entity_key: key, name, state: connected ? 'ok' : 'not_recorded', reason: connected ? null : 'No Mercury connection',
  connection: connected ? { status: 'active', org_name: `${name} Org`, last_synced_at: '2026-11-07T14:05:00Z', last_error: null } : null,
  accounts: connected ? [{ uid: `a-${key}`, kind: 'checking', ending: '4471', nickname: 'Operating', current_cents: 41238000, available_cents: 41238000, balance_read_at: '2026-11-07T14:05:00Z' }] : [],
  payment_accounts: 0,
});
const OVERVIEW = (over = {}) => ({
  as_of: '2026-11-07',
  entities: { state: 'ok', items: [ENTITY('holdings', 'Axal Holdings'), ENTITY('management', 'Axal VC Management'), ENTITY('gp', 'Axal GP'), ENTITY('fund', 'Axal Fund I')] },
  funds: { state: 'ok', items: [
    { fund_id: 1, name: 'Spin-Out Fund I', committed_cents: 1840000000, called_cents: 870000000, received_cents: 857500000, outstanding_cents: 12500000, overdue_lines: 4, next_due_date: '2026-12-15' },
    { fund_id: 2, name: 'Scout Fund', committed_cents: 0, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null },
  ] },
  fees: { state: 'ok', items: [{ fund_id: 1, state: 'ok', quarter: '2026Q4', status: 'draft', net_cents: 9200000 }, { fund_id: 2, state: 'not_recorded', reason: 'No fee period yet' }] },
  drafts: { state: 'ok', items: [{ fund_id: 1, entity_key: null, draft: 0, prepared: 3 }, { fund_id: 2, entity_key: null, draft: 0, prepared: 0 },
    { fund_id: null, entity_key: 'holdings', draft: 0, prepared: 0 }] },
  matches: { state: 'ok', items: [{ fund_id: 1, proposed: 2, needs_review: 0 }, { fund_id: 2, proposed: 0, needs_review: 0 }] },
  booklets: { state: 'ok', items: [{ fund_id: 1, waiting: 2 }, { fund_id: 2, waiting: 0 }] },
  ...over,
});
const QUIET = () => OVERVIEW({
  funds: { state: 'ok', items: [{ fund_id: 1, name: 'Spin-Out Fund I', committed_cents: 100000, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null }] },
  drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] }, booklets: { state: 'ok', items: [] },
});
const PERF = () => ({ as_of: '2026-11-07', items: [
  { id: 1, name: 'Spin-Out Fund I', status: 'active', vintage_year: 2026, nav_cents: 1020000000, distributed_cents: 130000000, unavailable: {} },
  { id: 2, name: 'Scout Fund', status: 'active', vintage_year: 2026, nav_cents: null, distributed_cents: 0, unavailable: { nav_cents: 'Every attributed position needs a dated valuation.' } },
] });
const ACTIVITY = { items: [
  { id: 41, at: '2026-11-06 14:12:00', act: 'capital_call.receipt', label: 'Record a receipt', fund_id: 1, fund_name: 'Spin-Out Fund I', lp_name: 'T. Lindqvist', call_number: null, amount_cents: 1000000, actor_name: 'M. Okafor' },
  { id: 40, at: '2026-11-05 09:30:00', act: 'fund.create', label: 'Create a fund', fund_id: 2, fund_name: 'Scout Fund', lp_name: null, call_number: null, amount_cents: null, actor_name: 'G. L.' },
], next_before: 40 };

function stubs(over = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', async () => ({ super_admin: true, acts: [{ act: 'capital_call.issue', allowed: true }] })),
        overview: rec('overview', async () => OVERVIEW()),
        activity: rec('activity', async ({ before } = {}) => (before ? { items: [{ ...ACTIVITY.items[1], id: 39, label: 'Issue a capital call', call_number: 3, amount_cents: 120000000 }], next_before: null } : ACTIVITY)),
        lps: rec('lps', async () => ({ funds: [], page: 1, per_page: 25, pages: 1, total_rows: 0, totals: { rows: 0, not_recorded: {} }, tally: { by_type: [] }, items: [] })),
      },
      performance: { list: rec('performance', async () => PERF()) },
      mercury: {}, fees: {}, reporting: { list: async () => ({ items: [] }) }, funds: {}, capitalAttestations: {},
    },
  };
}

async function mount(url, s = stubs()) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: SUPER, apis: s.apis }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    calls: s.calls, by,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    props: (id) => pr(by(id)),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

/* ------------------------------------------------------------------ the model */

test('workspaces own the old addresses; Funds sits in none', () => {
  assert.deepEqual(['overview', 'lps', 'calls', 'distributions', 'performance', 'reports', 'fees', 'banking', 'reconciliation', 'books', 'funds'].map(workspaceOf),
    ['overview', 'investors', 'capital', 'capital', 'portfolio', 'reporting', 'reporting', 'banking', 'banking', 'banking', null]);
});

test('Needs attention: overdue money first, every source named, and an unread source is never "nothing waits"', () => {
  const { items, unreadable } = attentionItems(OVERVIEW());
  assert.deepEqual(items.map((i) => i.key), ['overdue-1', 'match-1', 'packs-1', 'booklets-1', 'setup-2']);
  assert.equal(items[0].issue, '4 capital-call lines overdue');
  assert.deepEqual(items[0].action, { label: 'Open lines', to: '/admin/fund-admin/calls?fund=1' });
  assert.deepEqual(items[4].action, { label: 'Add LP', to: '/admin/fund-admin/lps?add=1&fund=2' });
  assert.deepEqual(unreadable, []);
  assert.deepEqual(attentionItems(OVERVIEW(), 2).items.map((i) => i.key), ['setup-2'], 'the scope keeps one fund');
  const broken = attentionItems(OVERVIEW({ matches: { state: 'unreadable', items: [] } }));
  assert.deepEqual(broken.unreadable, ['matches']);
  assert.ok(!broken.items.some((i) => i.key.startsWith('match-')));
  assert.deepEqual(attentionItems(QUIET()), { items: [], unreadable: [] });
});

test('Fund position: a sum only when every fund holds the figure; $0, Not recorded and Unreadable stay apart', () => {
  const ready = { status: 'ready', data: PERF() };
  const all = Object.fromEntries(fundPosition(OVERVIEW(), ready).map((f) => [f.key, f]));
  assert.deepEqual([all.committed.state, all.committed.cents], ['ok', 1840000000]);
  assert.deepEqual([all.distributed.state, all.distributed.cents], ['ok', 130000000]);
  assert.equal(all.nav.state, 'not_recorded', 'one fund with no NAV: the total is not recorded');
  assert.match(all.nav.reason, /dated valuation/);
  const scout = Object.fromEntries(fundPosition(OVERVIEW(), ready, 2).map((f) => [f.key, f]));
  assert.deepEqual([scout.committed.state, scout.committed.cents], ['ok', 0], 'a recorded zero is $0');
  assert.deepEqual([scout.distributed.state, scout.distributed.cents], ['ok', 0]);
  const one = Object.fromEntries(fundPosition(OVERVIEW(), ready, 1).map((f) => [f.key, f]));
  assert.deepEqual([one.nav.state, one.nav.cents, one.nav.note], ['ok', 1020000000, 'latest marks to 2026-11-07'], 'NAV keeps its own date');
  const failed = Object.fromEntries(fundPosition(OVERVIEW(), { status: 'unreadable' }).map((f) => [f.key, f.state]));
  assert.deepEqual([failed.nav, failed.distributed, failed.committed], ['unreadable', 'unreadable', 'ok']);
  const noFunds = Object.fromEntries(fundPosition(OVERVIEW({ funds: { state: 'unreadable', items: [] } }), ready).map((f) => [f.key, f.state]));
  assert.equal(noFunds.committed, 'unreadable', 'a failed funds block is Unreadable, never $0');
});

test('Funds rows: what waits as chips, a quiet line when nothing does, and a failed source says so', () => {
  const rows = healthRows(OVERVIEW(), { status: 'ready', data: PERF() });
  assert.equal(rows[0].ident, 'Active · Vintage 2026');
  assert.deepEqual(rows[0].chips.map((c) => c.text), ['4 lines overdue', '3 ready to issue', '2 to match']);
  assert.deepEqual(rows[1].quiet, ['No line due', 'No reports waiting', 'No bank match waiting']);
  assert.equal(rows[1].setup, true);
  const broken = healthRows(OVERVIEW({ drafts: { state: 'unreadable', items: [] } }), null);
  assert.ok(broken[1].chips.some((c) => c.state === 'Unreadable' && c.text === 'Reports unreadable'));
  assert.equal(healthRows(OVERVIEW({ funds: { state: 'unreadable', items: [] } })), null);
});

test('activity rows: by name, an amount only when one is recorded, the audit reference', () => {
  assert.deepEqual(activityRow(ACTIVITY.items[0]), { id: 41, fund: 'Spin-Out Fund I', what: 'Record a receipt · T. Lindqvist', amount: '$10,000.00', actor: 'M. Okafor', ref: 'audit #41' });
  assert.equal(activityRow(ACTIVITY.items[1]).amount, null, 'no amount, never $0');
  const now = new Date('2026-11-06T18:00:00Z');
  assert.equal(activityTime('2026-11-06 14:12:00', now), '14:12');
  assert.equal(activityTime('2026-11-05 09:30:00', now), '5 Nov');
  assert.equal(activityTime('2025-12-01 09:30:00', now), '1 Dec 2025');
});

test('the client: activity reaches only its mounted Worker route', () => {
  const src = readFileSync('frontend/src/lib/api/fundAdmin.js', 'utf8');
  assert.match(src, /request\(`\/fund-admin\/activity\$\{s \? `\?\$\{s\}` : ''\}`\)/);
  assert.equal(typeof fundAdminApi.activity, 'function');
  const worker = readFileSync('cloudflare-worker/src/routes/fund_admin.ts', 'utf8');
  assert.match(worker, /fundAdmin\.get\('\/activity'/);
});

/* ------------------------------------------------------------------ mounted */

test('the Overview draws attention, position, funds, activity and banking, in that order', async () => {
  const v = await mount('/admin/fund-admin');
  try {
    const order = ['overview-attention', 'overview-position', 'overview-funds', 'overview-activity', 'overview-banking'];
    const ids = v.ids();
    assert.deepEqual(order.map((id) => ids.indexOf(id)).slice().sort((a, b) => a - b), order.map((id) => ids.indexOf(id)), ids.join(','));
    assert.ok(order.every((id) => ids.includes(id)));
    assert.match(v.text('overview-attention'), /5 items · overdue money first/);
    assert.match(v.text('position-committed'), /\$18,400,000\.00/);
    assert.match(v.text('position-nav'), /— Not recorded/);
    assert.match(v.text('position-distributed'), /\$1,300,000\.00/);
    assert.equal(v.text('fund-admin-primary'), 'Review overdue lines');
    assert.ok(/min-h-\[44px\]/.test(v.props('overview-attention-go-overdue-1').className), 'a 44px target on a phone');
  } finally { await v.close(); }
});

test('nothing waiting is one green line; no entity connected is one line, with the entities folded', async () => {
  const v = await mount('/admin/fund-admin', stubs({ overview: async () => QUIET() }));
  try {
    assert.match(v.text('overview-attention-clear'), /Nothing currently requires action\./);
    assert.match(v.text('overview-banking-none'), /No Axal entity is connected to Mercury yet\./);
    assert.match(v.text('overview-entities-more'), /View entities \(4\)/);
    assert.ok(v.by('overview-entity-holdings'), 'the cards are still there, folded');
    assert.doesNotMatch(v.text('overview'), /0 draft · 0 prepared/, 'no rows of zeros');
  } finally { await v.close(); }
  const c = await mount('/admin/fund-admin', stubs({ overview: async () => OVERVIEW({ entities: { state: 'ok', items: [ENTITY('management', 'Axal VC Management', true), ENTITY('gp', 'Axal GP')] } }) }));
  try {
    assert.ok(c.by('overview-entity-management') && !c.by('overview-banking-none'));
    assert.match(c.text('overview-entities-more'), /1 other entity is not connected · View entities \(2\)/);
  } finally { await c.close(); }
});

test('an unread source: Needs attention names it, never the green line', async () => {
  const v = await mount('/admin/fund-admin', stubs({ overview: async () => ({ ...QUIET(), drafts: { state: 'unreadable', items: [] } }) }));
  try {
    assert.ok(v.by('overview-drafts-unreadable'));
    assert.ok(!v.by('overview-attention-clear'));
  } finally { await v.close(); }
  const p = await mount('/admin/fund-admin', stubs({ performance: async () => { throw new Error('down'); } }));
  try {
    assert.ok(p.by('position-nav-unreadable') && p.by('position-distributed-unreadable'));
    assert.match(p.text('position-committed'), /\$18,400,000\.00/, 'the ledger figures still draw');
  } finally { await p.close(); }
});

test('Recent activity: rows by name, Show older pages back, empty and unreadable say so', async () => {
  const v = await mount('/admin/fund-admin');
  try {
    assert.match(v.text('overview-activity-41'), /Spin-Out Fund I Record a receipt · T\. Lindqvist \$10,000\.00 M\. Okafor · audit #41/);
    await v.click('overview-activity-more');
    assert.deepEqual(v.calls.filter((c) => c[0] === 'activity').map((c) => c[1]), [{ fund: null }, { fund: null, before: 40 }]);
    assert.match(v.text('overview-activity-39'), /Issue a capital call · call 3 \$1,200,000\.00/);
    assert.ok(!v.by('overview-activity-more'), 'no older page left');
  } finally { await v.close(); }
  const e = await mount('/admin/fund-admin', stubs({ activity: async () => ({ items: [], next_before: null }) }));
  try { assert.equal(e.text('overview-activity-empty'), 'No fund activity yet.'); } finally { await e.close(); }
  const u = await mount('/admin/fund-admin', stubs({ activity: async () => { throw Object.assign(new Error('x'), { status: 503 }); } }));
  try {
    assert.ok(u.by('overview-activity-unreadable'));
    assert.ok(!u.by('overview-activity-empty'), 'a failed read is not "no activity"');
  } finally { await u.close(); }
});

test('the fund scope narrows every part of the Overview, and the activity read', async () => {
  const v = await mount('/admin/fund-admin?fund=2');
  try {
    assert.match(v.text('fund-admin-scope'), /Fund scope: Scout Fund/);
    assert.equal(v.props('fund-admin-filter-f-2')['aria-current'], 'true');
    assert.ok(v.by('overview-fund-2') && !v.by('overview-fund-1'));
    assert.ok(!v.by('overview-attention-overdue-1'));
    assert.match(v.text('position-committed'), /\$0\.00/, 'a recorded zero is $0');
    assert.deepEqual(v.calls.find((c) => c[0] === 'activity'), ['activity', { fund: 2 }]);
    assert.equal(v.text('fund-admin-primary'), 'Add LP', 'never New capital call on a fund with nothing committed');
    assert.ok(!v.by('fund-admin-flag-capital'), 'the flags follow the scope');
  } finally { await v.close(); }
});

test('Refresh rereads the overview, the access table, the performance list and the activity', async () => {
  const v = await mount('/admin/fund-admin');
  try {
    const count = (n) => v.calls.filter((c) => c[0] === n).length;
    const before = ['overview', 'access', 'performance', 'activity'].map(count);
    await v.click('fund-admin-refresh');
    assert.deepEqual(['overview', 'access', 'performance', 'activity'].map(count), before.map((n) => n + 1));
  } finally { await v.close(); }
});
