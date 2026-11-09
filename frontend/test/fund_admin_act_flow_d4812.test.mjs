// D4812 part 5 (#4812, FA-03 and FA-08) — the remaining acts on the money
// flow: fee terms and fee periods, report packs, bank matches, economics and
// valuation marks each show their exact effect, name the act on the one
// button, ask the authenticator code for a Super Admin act only, and end on
// the server's receipt.
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_act_flow_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  actGate, economicsEffects, feePeriodEffects, feeTermsEffects, markEffects, matchEffects, reportIssueEffects,
} from '../src/pages/admin/fundAdmin/moneyFlowModel.js';

const h = React.createElement;
const fx = (rows) => Object.fromEntries(rows);

/* ------------------------------------------------------------------ the model */

test('each act\'s effect: figures it read, Not recorded with a reason, never a guessed 0', () => {
  const fund = { name: 'Spin-Out Fund I', carried_interest: 0.2, management_fee: 0.02 };
  const period = fx(feePeriodEffects(fund, { quarter: '2026Q4', totals: { gross_cents: 9200000, catch_up_cents: 0, applied_cents: null, net_cents: 9200000 } }));
  assert.deepEqual([period.Quarter, period['Gross fee'], period['Catch-up'], period['Net fee']], ['2026Q4', '$92,000.00', '$0.00', '$92,000.00']);
  assert.equal(period['Offset applied'].notRecorded, true, 'an absent figure is not $0');
  const terms = fx(feeTermsEffects(fund, { annual_bps: 200, effective_from: '2026-01-01', lpa_reference: null }));
  assert.deepEqual([terms['Annual rate'], terms.Status], ['2.00%', 'Draft → Confirmed']);
  assert.equal(terms['LPA reference'].notRecorded, true);
  const econ = fx(economicsEffects(fund, { carried_interest: 0.25, reason: 'Side letter agreed at first close.' }));
  assert.deepEqual([econ.Carry, econ['Management fee']], ['20.00% → 25.00%', '2.00% (unchanged)']);
  const mark = fx(markEffects({ id: 9, company_name: 'Nebula Compute', marked: true, value_cents: 200000000 }, { value_cents: 240000000, valuation_date: '2026-11-02', source: 'Priced round' }));
  assert.deepEqual([mark.Value, mark['Previous mark']], ['$2,400,000.00', '$2,000,000.00']);
  assert.equal(fx(markEffects({ id: 9, marked: false }, { value_cents: 1 }))['Previous mark'].notRecorded, true, 'no earlier mark is not $0');
  assert.deepEqual(fx(matchEffects({ amount_cents: 5000000, counterparty_name: 'HARBOR FAMILY OFF', posted_on: '2026-11-06' }, 'Capital-call line #11')).Pays, 'Capital-call line #11');
  assert.match(fx(reportIssueEffects({ kind: 'lp_quarterly_report', period_label: 'Q3 2026' }, 'f'.repeat(64))).Figures, /^ffffffffffff… \(frozen on issue\)$/);
});

test('the gate: the Worker\'s tier decides the code; an unlisted act is the Worker\'s to refuse; an unread table stops', () => {
  const access = { acts: [
    { act: 'fee_period.issue', allowed: true, sentence: 'A Super Admin issues fee periods.' },
    { act: 'mercury.reconcile', allowed: true, sentence: null },
  ] };
  assert.deepEqual(actGate(access, 'fee_period.issue'), { state: 'allowed', tier: 'super_admin' });
  assert.deepEqual(actGate(access, 'mercury.reconcile'), { state: 'allowed', tier: 'admin' });
  assert.deepEqual(actGate(access, 'fund.valuation'), { state: 'allowed', tier: null }, 'as FundActControl: not listed is not refused');
  assert.deepEqual(actGate(null, 'fee_period.issue'), { state: 'unverified' });
});

/* ------------------------------------------------------------------ mounted */

const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const OVERVIEW = { as_of: '2026-11-09', entities: { state: 'ok', items: [] }, funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund I', committed_cents: 1, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null }] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } };
const ACCESS = { super_admin: true, acts: [
  { act: 'fee_period.issue', tier: 'super_admin', allowed: true, sentence: 'A Super Admin issues fee periods.' },
  { act: 'fee.write', tier: 'admin', allowed: true, sentence: null },
  { act: 'mercury.reconcile', tier: 'admin', allowed: true, sentence: null },
] };

function stubs(over = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  return {
    calls,
    apis: {
      auth: { stepUp: rec('stepUp', async () => ({ ok: true })) },
      fundAdmin: { access: rec('access', async () => ACCESS), overview: async () => OVERVIEW, activity: async () => ({ items: [] }) },
      fees: {
        state: async () => ({ terms: [], lps: [], periods: [] }),
        previewPeriod: rec('previewPeriod', async (id, q) => ({ quarter: q, digest: 'd'.repeat(64), totals: { gross_cents: 9200000, catch_up_cents: 0, applied_cents: 0, net_cents: 9200000 } })),
        issuePeriod: rec('issuePeriod', async () => ({ ok: true })),
        lines: async () => ({ items: [] }),
      },
      mercury: {
        matches: async () => ({ ok: true, items: [{ uid: 'm-1', target_kind: 'capital_call_line', target_id: 11, state: 'proposed', amount_cents: 5000000, posted_on: '2026-11-06', counterparty_name: 'HARBOR FAMILY OFF', entity_key: 'fund', last_four: '4471' }] }),
        confirmMatch: rec('confirmMatch', async () => ({ ok: true })),
        transactions: async () => ({ ok: true, items: [] }),
      },
      performance: { list: async () => ({ items: [] }) }, reporting: { list: async () => ({ items: [] }) }, funds: {},
    },
  };
}

async function mount(url, s) {
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
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  return {
    calls: s.calls, by,
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await flush(); },
    async submit(id) { await act(async () => { await pr(need(id)).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

async function previewFee(m) {
  await m.type('fee-quarter', '2026Q4');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  let form = m.by('fee-preview-submit');
  while (form && !pr(form).onSubmit) form = form.parentNode;
  await act(async () => { await pr(form).onSubmit({ preventDefault() {} }); });
  await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}

test('a Super Admin fee period: the code comes before the act, the button names the net fee, and a receipt follows', async () => {
  const s = stubs();
  const m = await mount('/admin/fund-admin/fees?fund=7', s);
  try {
    await previewFee(m);
    await m.click('fee-issue');
    assert.match(m.text('fee-flow-effects'), /Net fee \$92,000\.00/);
    await m.click('fee-flow-continue');
    assert.equal(m.text('fee-flow-confirm-submit'), 'Issue $92,000.00 2026Q4 fee period');
    await m.submit('fee-flow-confirm');
    assert.match(m.text('fee-flow-confirm-code-error'), /6-digit code/);
    assert.ok(!s.calls.some(([n]) => n === 'issuePeriod'), 'nothing is issued without the code');
    await m.type('fee-flow-confirm-code', '123456');
    await m.submit('fee-flow-confirm');
    const step = s.calls.findIndex(([n]) => n === 'stepUp');
    const issue = s.calls.findIndex(([n]) => n === 'issuePeriod');
    assert.ok(step >= 0 && step < issue, 'the step-up runs first');
    assert.match(m.text('fee-flow-done'), /Confirmed by the server at \d{2}:\d{2}:\d{2} UTC/);
  } finally { await m.close(); }
});

test('an Admin act (a bank match) asks no code; a Worker refusal stays at Confirm with no receipt', async () => {
  const s = stubs({ confirmMatch: async () => { throw new Error('This line was paid by another transaction.'); } });
  const m = await mount('/admin/fund-admin/banking/reconciliation', s);
  try {
    await m.click('match-confirm-m-1');
    assert.match(m.text('match-flow-m-1-steps'), /Authenticate · not required/);
    await m.click('match-flow-m-1-continue');
    assert.ok(!m.by('match-flow-m-1-confirm-code'));
    assert.equal(m.text('match-flow-m-1-confirm-submit'), 'Confirm $50,000.00 match');
    await m.submit('match-flow-m-1-confirm');
    assert.equal(m.text('match-flow-m-1-confirm-error'), 'This line was paid by another transaction.');
    assert.ok(!m.by('match-flow-m-1-done'), 'no receipt for a refused act');
    assert.ok(!s.calls.some(([n]) => n === 'stepUp'));
  } finally { await m.close(); }
});

test('permissions that cannot be verified stop the flow at Review', async () => {
  const s = stubs({ access: async () => { throw new Error('down'); } });
  const m = await mount('/admin/fund-admin/banking/reconciliation', s);
  try {
    await m.click('match-confirm-m-1');
    assert.match(m.text('match-flow-m-1-refused-unverified'), /Permissions could not be verified\. Financial actions are temporarily unavailable\./);
    assert.ok(!m.by('match-flow-m-1-continue'));
  } finally { await m.close(); }
});
