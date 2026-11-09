// D4812 part 7 (#4812, board FA-09) — Fund administration at 390 wide:
//
//   · A: Needs attention as records, each action a 44px target;
//   · B: an LP record that says what is owed and leads, in one 48px tap, to
//     Record receipt;
//   · C: a reconciliation match whose confirm opens as a bottom sheet, its
//     bank and ledger sides stacked;
//   · D: the money act's one button 48px tall and naming the amount;
//   · the console's text actions still 44px targets on a phone.
//
// The phone is a stubbed `matchMedia`. Every name, id and amount is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_phone_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { TAP_LINK } from '../src/pages/admin/fundAdmin/parts.jsx';

const h = React.createElement;
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const ACCESS = { super_admin: false, acts: [{ act: 'mercury.reconcile', tier: 'admin', allowed: true }, { act: 'capital_call.receipt', tier: 'admin', allowed: true }] };
const OVERVIEW = { as_of: '2026-11-09', entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [{ fund_id: 1, name: 'Spin-Out Fund I', committed_cents: 25000000, called_cents: 15000000, received_cents: 12500000, outstanding_cents: 2500000, overdue_lines: 1, next_due_date: '2026-11-01' }] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [{ entity_key: 'fund', proposed: 1, needs_review: 0 }] } };
const LP = { limited_partner_id: 11, fund_id: 1, fund_name: 'Spin-Out Fund I', name: 'K. Osei', email: null, lp_type: 'individual',
  commitment_cents: 25000000, called_cents: 15000000, received_cents: 12500000, outstanding_cents: 2500000, distributed_cents: 0,
  lpa_signed: 1, lpa_signed_at: '2026-01-10', kyc_status: 'approved', booklet: null, last_notice: null, unavailable: { booklet: 'No application.' } };
const MATCH = { uid: 'm-1', target_kind: 'capital_call_line', target_id: 11, state: 'proposed', amount_cents: 5000000, posted_on: '2026-11-06',
  counterparty_name: 'HARBOR FAMILY OFF', entity_key: 'fund', last_four: '4471',
  ledger: { kind: 'capital_call_line', fund_id: 1, lp_name: 'Harbor Family Office', call_number: 3, due_on: '2026-11-01', outstanding_cents: 12500000 }, ledger_unavailable: null };

async function mount(url, lp = LP) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const roster = { as_of: '2026-11-09', funds: [{ id: 1, name: 'Spin-Out Fund I' }], page: 1, per_page: 25, pages: 1, total_rows: 1,
    totals: { commitment_cents: 25000000, not_recorded: {} }, tally: { by_type: [], overdue_lines: 1, lpa_pending: 0 }, items: [lp] };
  const apis = {
    fundAdmin: { access: async () => ACCESS, overview: async () => OVERVIEW, activity: async () => ({ items: [] }), lps: async () => roster },
    lps: { ledger: async () => ({ calls: [], truncated: false }) },
    mercury: { matches: async () => ({ ok: true, items: [MATCH] }), transactions: async () => ({ ok: true, items: [] }), confirmMatch: async () => ({ ok: true }) },
    auth: { stepUp: async () => ({ ok: true }) },
    fees: {}, performance: { list: async () => ({ items: [] }) }, reporting: { list: async () => ({ items: [] }) }, funds: {},
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: ADMIN, apis }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const all = () => walk(document.body);
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  return {
    by, props: (id) => pr(need(id)),
    text: (id) => txt(need(id)).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); delete globalThis.matchMedia; },
  };
}

const TALL = { 44: /(^|\s)(max-sm:)?min-h-\[44px\]/, 48: /(^|\s)(max-sm:)?min-h-\[48px\]/ };
const tall = (cls, px) => TALL[px].test(String(cls || ''));

test('A: Needs attention is records, each action a 44px target on a phone', async () => {
  const v = await mount('/admin/fund-admin');
  try {
    const go = v.props('overview-attention-go-overdue-1');
    assert.ok(tall(go.className, 44), 'the overdue item\'s action is 44px');
  } finally { await v.close(); }
});

test('B: the LP record says what is owed and leads to Record receipt in one 48px tap', async () => {
  const v = await mount('/admin/fund-admin/lps/11?fund=1');
  try {
    assert.match(v.text('lp-summary-owed'), /\$25,000\.00 outstanding Record receipt…/);
    const cls = v.props('lp-summary-receipt').className;
    assert.ok(tall(cls, 48) && /max-sm:w-full/.test(cls), 'a full-width 48px button on a phone');
    await v.click('lp-summary-receipt');
    assert.ok(v.by('lp-panel-calls'), 'it opens the LP\'s call lines, where each open line records its receipt');
  } finally { await v.close(); }
  const paid = await mount('/admin/fund-admin/lps/11?fund=1', { ...LP, outstanding_cents: 0 });
  try {
    assert.ok(!paid.by('lp-summary-owed'), 'nothing owed, no receipt prompt');
  } finally { await paid.close(); }
});

test('C and D: a match confirms in a bottom sheet, its sides stacked; the money button is 48px and names the amount', async () => {
  const v = await mount('/admin/fund-admin/banking/reconciliation');
  try {
    assert.doesNotMatch(String(v.props('match-pair-m-1').children?.[0]?.props?.className || ''), /(^|\s)grid-cols-/, 'bank and ledger stack below sm');
    await v.click('match-confirm-m-1');
    assert.equal(v.props('match-flow-m-1-layer')['data-phone'], 'sheet', 'the confirm is a bottom sheet');
    await v.click('match-flow-m-1-continue');
    const submit = v.props('match-flow-m-1-confirm-submit');
    assert.ok(tall(submit.className, 48), 'the money button is 48px');
    assert.equal(v.text('match-flow-m-1-confirm-submit'), 'Confirm match and record $50,000.00 receipt');
  } finally { await v.close(); }
});

test('the console\'s text actions are 44px targets on a phone', () => {
  assert.match(TAP_LINK, /max-sm:min-h-\[44px\]/);
  assert.match(TAP_LINK, /max-sm:inline-flex/);
});
