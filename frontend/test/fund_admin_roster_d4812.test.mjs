// D4812 part 4 (#4812, board FA-02) — the LP roster: active filters as chips
// that remove themselves, a result line over every row the filters keep, the
// LP's name as the way in, an identity the store could not read said as
// Unreadable (not Not recorded), and Export view through the Worker.
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_roster_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { ROW_MENU, activeChips, resultLine, rosterQuery } from '../src/pages/admin/fundAdmin/lpsModel.js';

const h = React.createElement;
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const UNREADABLE = 'Unreadable: this store could not be read. Try again.';
const ROW = (id, name, extra = {}) => ({
  limited_partner_id: id, fund_id: 1, fund_name: 'Spin-Out Fund I', name, email: null, lp_type: 'individual',
  commitment_cents: 25000000, called_cents: 15000000, received_cents: 12500000, outstanding_cents: 2500000, distributed_cents: 0,
  lpa_signed: 0, kyc_status: 'approved', booklet: null, last_notice: null, unavailable: { booklet: 'No application.', last_notice: 'No notice yet.' }, ...extra,
});
const ROSTER = () => ({
  as_of: '2026-11-09', funds: [{ id: 1, name: 'Spin-Out Fund I' }], page: 1, per_page: 25, pages: 2, total_rows: 42,
  totals: { commitment_cents: 1240000000, not_recorded: {} }, tally: { by_type: [], overdue_lines: 0, lpa_pending: 2 },
  items: [ROW(11, 'K. Osei'), ROW(12, 'T. Lindqvist', { kyc_status: null, unavailable: { kyc_status: UNREADABLE } }), ROW(13, 'M. Ruiz', { kyc_status: null, unavailable: { kyc_status: 'No identity check is recorded.' } })],
});

/* ------------------------------------------------------------------ the model */

test('each active filter is a chip; the fund scope is the header\'s, not a chip', () => {
  const q = rosterQuery('?fund=1&lpa=unsigned&identity=pending&outstanding=1&q=Lu');
  assert.deepEqual(activeChips(q).map((c) => [c.key, c.label]), [['q', 'Search: Lu'], ['lpa', 'LPA pending'], ['identity', 'Identity: Waiting'], ['outstanding', 'Has outstanding']]);
  assert.deepEqual(activeChips(rosterQuery('?fund=1')), []);
});

test('the result line counts every row the filters keep, with their committed total', () => {
  assert.equal(resultLine(ROSTER()), '42 LPs · $12,400,000.00 committed · showing 1–25');
  assert.equal(resultLine({ ...ROSTER(), page: 2 }), '42 LPs · $12,400,000.00 committed · showing 26–42');
  assert.equal(resultLine({ ...ROSTER(), totals: { commitment_cents: 100, not_recorded: { commitment_cents: 3 } } }), '42 LPs · $1.00 committed (3 LPs with none recorded) · showing 1–25');
  assert.equal(resultLine({ ...ROSTER(), total_rows: 0, totals: { commitment_cents: null, not_recorded: {} } }), '0 LPs · commitment not recorded');
});

test('Open is the LP\'s name, never in the row menu', () => {
  assert.deepEqual(ROW_MENU.map(([k]) => k), ['type', 'contact']);
});

/* ------------------------------------------------------------------ mounted */

function stubs(over = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: async () => ({ super_admin: false, acts: [{ act: 'fund.write', allowed: true }] }),
        overview: async () => ({ as_of: '2026-11-09', entities: { state: 'ok', items: [] }, funds: { state: 'ok', items: [{ fund_id: 1, name: 'Spin-Out Fund I', committed_cents: 1, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null }] }, fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } }),
        lps: rec('lps', async () => ROSTER()),
        exportLps: rec('exportLps', async () => ({ name: 'fund-admin-lps-2026-11-09.csv' })),
      },
      lps: {}, performance: { list: async () => ({ items: [] }) }, mercury: {}, fees: {}, reporting: {}, funds: {},
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
  const at = { search: '' };
  function Probe() { at.search = useLocation().search; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: ADMIN, apis: s.apis }), h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    at, calls: s.calls, by, props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('chips name each filter and ✕ removes only its own from the address', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=1&lpa=unsigned&outstanding=1');
  try {
    assert.match(v.text('lps-chips'), /LPA pending ✕ Has outstanding ✕/);
    assert.equal(v.props('lps-chip-lpa')['aria-label'], 'Remove filter: LPA pending');
    await v.click('lps-chip-outstanding');
    const p = new URLSearchParams(v.at.search);
    assert.deepEqual([p.get('outstanding'), p.get('lpa'), p.get('fund')], [null, 'unsigned', '1'], 'only its own filter goes');
    assert.match(v.text('lps-table-panel'), /42 LPs · \$12,400,000\.00 committed · showing 1–25/);
  } finally { await v.close(); }
});

test('the name opens the LP; an unreadable identity is Unreadable, a missing one Not recorded', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=1');
  try {
    assert.match(v.props('lps-open-11').href, /^\/admin\/fund-admin\/lps\/11/);
    assert.match(v.text('lps-identity-unreadable-12'), /! Unreadable · Retry/);
    assert.ok(!v.by('lps-identity-unreadable-13'));
    assert.match(v.text('lps-row-13'), /Not recorded/);
  } finally { await v.close(); }
});

test('Export view sends the roster\'s own filters to the Worker and says what it wrote, or why not', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=1&lpa=unsigned&page=2');
  try {
    await v.click('lps-export');
    const [, q] = v.calls.find(([n]) => n === 'exportLps');
    assert.deepEqual([q.fund, q.lpa], ['1', 'unsigned']);
    assert.equal(v.text('lps-export-status'), 'Exported fund-admin-lps-2026-11-09.csv.');
  } finally { await v.close(); }
  const f = await mount('/admin/fund-admin/lps', stubs({ exportLps: async () => { throw new Error('Nothing was read, because its audit row could not be written.'); } }));
  try {
    await f.click('lps-export');
    assert.equal(f.props('lps-export-status').role, 'alert');
    assert.equal(f.text('lps-export-status'), 'Nothing was read, because its audit row could not be written.');
  } finally { await f.close(); }
});
