// D4812 part 2 (#4812, boards FA-03 and FA-08) — the money-action flow:
// Prepare → Review → Confirm → Authenticate → Receipt, the exact effect before
// the act, a button that names the act and the amount, the authenticator code
// for a Super Admin act, and the three ways an act is not offered (FA-05d).
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_money_flow_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  STEPS, actButton, actGate, callEffects, checkCode, distributionEffects, receiptEffects, stepsFor,
} from '../src/pages/admin/fundAdmin/moneyFlowModel.js';

const h = React.createElement;
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const ACCESS = (sa) => ({ super_admin: sa, acts: [
  { act: 'capital_call.issue', tier: 'super_admin', allowed: sa, sentence: 'A Super Admin issues capital calls.' },
  { act: 'capital_call.receipt', tier: 'admin', allowed: true, sentence: null },
] });

/* ------------------------------------------------------------------ the model */

test('five steps in order; only a Super Admin act authenticates', () => {
  assert.deepEqual(STEPS, ['Prepare', 'Review', 'Confirm', 'Authenticate', 'Receipt']);
  assert.deepEqual(stepsFor('admin').filter((s) => s.skipped).map((s) => s.label), ['Authenticate']);
  assert.deepEqual(stepsFor('super_admin').filter((s) => s.skipped), []);
});

test('the button names the act and the amount, never a bare Confirm', () => {
  assert.equal(actButton('Issue', 45000000, 'capital call'), 'Issue $450,000.00 capital call');
  assert.equal(actButton('Execute', 31000000, 'distribution'), 'Execute $310,000.00 distribution');
  assert.equal(actButton('Issue', null, 'capital call'), 'Issue capital call', 'no amount is never $0');
});

test('the gate: allowed, refused with the act table\'s sentence, or unverified when the table did not read', () => {
  assert.deepEqual(actGate(ACCESS(true), 'capital_call.issue'), { state: 'allowed', tier: 'super_admin' });
  assert.deepEqual(actGate(ACCESS(false), 'capital_call.issue'), { state: 'refused', sentence: 'A Super Admin issues capital calls.' });
  assert.deepEqual(actGate(null, 'capital_call.issue'), { state: 'unverified' });
});

test('the code is six digits', () => {
  assert.deepEqual(checkCode(' 123 456 '), { code: '123456' });
  assert.match(checkCode('').error, /6-digit code/);
  assert.equal(checkCode('12345').error, 'The code is six digits.');
  assert.equal(checkCode('12345a').error, 'The code is six digits.');
});

test('a call\'s effect: outstanding before and after, and Not recorded when the ledger did not read', () => {
  const rows = [{ lp_id: 1 }, { lp_id: 2 }];
  const fx = Object.fromEntries(callEffects({ fund: { name: 'Spin-Out Fund I' }, terms: { due: '2026-12-15' }, preview: { amount_cents: 45000000 }, rows, summary: { outstanding_cents: 12500000 } }));
  assert.deepEqual(fx, {
    Fund: 'Spin-Out Fund I', Amount: '$450,000.00', 'LPs affected': '2', 'Due date': '2026-12-15',
    'Current outstanding': '$125,000.00', 'Outstanding after issue': '$575,000.00',
    Documents: 'Call notices are issued separately, from Call notices, once the call exists.',
  });
  const blind = Object.fromEntries(callEffects({ fund: { name: 'F' }, terms: { due: 'x' }, preview: { amount_cents: 100 }, rows, summary: null }));
  assert.equal(blind['Current outstanding'].notRecorded, true);
  assert.equal(blind['Outstanding after issue'].notRecorded, true, 'never a guessed $0 before');
});

test('a receipt\'s and a distribution\'s effect', () => {
  const r = Object.fromEntries(receiptEffects({ line: { lp_name: 'K. Osei', outstanding_cents: 2500000 }, call: { call_number: 3 }, body: { amount_cents: 2500000, received_on: '2026-11-06', reference: '' } }));
  assert.equal(r['Outstanding on this line'], '$25,000.00 → $0.00');
  assert.equal(r.Reference, 'None given');
  const d = Object.fromEntries(distributionEffects({ fund: { name: 'F' }, split: { proceeds_cents: 100000, carry_withheld_cents: null, lines: [{ amount_cents: 60000 }, { amount_cents: 30000 }] } }));
  assert.deepEqual([d.Proceeds, d['To LPs'], d['LP lines']], ['$1,000.00', '$900.00', '2']);
  assert.equal(d['Carry withheld'].notRecorded, true);
});

/* ------------------------------------------------------------------ mounted */

const LEDGER = (committed = 50000000) => ({ ok: true, summary: { committed_cents: committed, committed_lps: 2, called_cents: 0, received_cents: 0, outstanding_cents: 2500000, calls_count: 0 }, calls: [], unnumbered: [], truncated: false });
const OVERVIEW = { as_of: '2026-11-08', entities: { state: 'ok', items: [] }, funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund I', committed_cents: 50000000, called_cents: 0, received_cents: 0, outstanding_cents: 2500000, overdue_lines: 0, next_due_date: null }] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } };

function stubs(over = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  return {
    calls,
    apis: {
      auth: { stepUp: rec('stepUp', async () => ({ ok: true })) },
      fundAdmin: { access: rec('access', async () => ACCESS(true)), overview: rec('overview', async () => OVERVIEW), activity: async () => ({ items: [], next_before: null }) },
      calls: {
        ledger: rec('ledger', async () => LEDGER()),
        preview: rec('callPreview', async () => ({ ok: true, next_call_number: 1, residual_cents: 0, excluded: [], lines: [
          { lp_id: 1, lp_name: 'LP One', share_cents: 600000, pct: 0.6, has_account: true, kyc_status: 'approved' },
          { lp_id: 2, lp_name: 'LP Two', share_cents: 400000, pct: 0.4, has_account: true, kyc_status: 'approved' }] })),
        issue: rec('callIssue', async () => ({ ok: true, call: { call_number: 1 }, lines_written: 2, due_date: '2026-12-01' })),
        receipt: rec('receipt', async () => ({ ok: true })),
      },
      performance: { list: async () => ({ items: [] }) },
      mercury: {}, fees: {}, reporting: { list: async () => ({ items: [] }) }, funds: {}, notices: {},
    },
  };
}

async function mount(user, s) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/fund-admin/calls?fund=7'] }, h(FundAdminConsoleView, { user, apis: s.apis }))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  const formOf = (id) => { const all = walk(container); let n = need(id); while (n && n.tagName?.toLowerCase() !== 'form') n = all.find((p) => (p.childNodes || []).includes(n)); return n; };
  return {
    by, props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {}, button: 0 }); }); await flush(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await flush(); },
    async submit(id) { await act(async () => { await pr(formOf(id)).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

async function toReview(m) {
  await m.click('calls-new');
  await m.type('calls-new-amount', '10000');
  await m.type('calls-new-due', '2026-12-01');
  await m.submit('calls-new-preview');
}

test('the steps mark where the flow is, and a Super Admin call asks for the code', async () => {
  const s = stubs();
  const m = await mount(SUPER, s);
  try {
    await toReview(m);
    assert.equal(m.props('money-flow-steps-review')['aria-current'], 'step');
    assert.match(m.text('calls-effects'), /Current outstanding \$25,000\.00 Outstanding after issue \$35,000\.00/);
    await m.click('calls-preview-continue');
    assert.equal(m.props('money-flow-steps-authenticate')['aria-current'], 'step');
    assert.match(m.text('money-flow-steps'), /Prepare.*Review.*Confirm.*Authenticate.*Receipt/);
  } finally { await m.close(); }
});

test('a refused code stops the act, says so on the field, and keeps the flow', async () => {
  const s = stubs({ stepUp: async () => { throw new Error('That code has expired.'); } });
  const m = await mount(SUPER, s);
  try {
    await toReview(m);
    await m.click('calls-preview-continue');
    await m.type('calls-confirm-code', '111111');
    await m.submit('calls-confirm-submit');
    assert.equal(m.text('calls-confirm-code-error'), 'The code was not accepted: That code has expired.');
    assert.equal(m.props('calls-confirm-code')['aria-invalid'], 'true');
    assert.equal(m.props('calls-confirm-code')['aria-describedby'], m.props('calls-confirm-code-error').id, 'the error belongs to the field');
    assert.ok(!s.calls.some(([n]) => n === 'callIssue'), 'nothing is issued');
    assert.ok(m.by('calls-confirm-submit'));
  } finally { await m.close(); }
});

test('the Worker\'s refusal of the act is shown at Confirm, never a receipt', async () => {
  const s = stubs({ callIssue: async () => { throw new Error('The fund has no LP with a commitment.'); } });
  const m = await mount(SUPER, s);
  try {
    await toReview(m);
    await m.click('calls-preview-continue');
    await m.type('calls-confirm-code', '123456');
    await m.submit('calls-confirm-submit');
    assert.equal(m.text('calls-confirm-error'), 'The fund has no LP with a commitment.');
    assert.ok(!m.by('calls-receipt-flow'));
  } finally { await m.close(); }
});

test('an Admin reviews and reads the sentence; an unread act table stops at Review', async () => {
  const a = await mount(ADMIN, stubs({ access: async () => ACCESS(false) }));
  try {
    await toReview(a);
    assert.ok(a.by('calls-effects'), 'an Admin sees the exact effect');
    assert.equal(a.text('calls-preview-issue-refused'), 'A Super Admin issues capital calls.');
    assert.ok(!a.by('calls-preview-continue'));
  } finally { await a.close(); }
  const u = await mount(SUPER, stubs({ access: async () => { throw new Error('down'); } }));
  try {
    await toReview(u);
    assert.match(u.text('calls-preview-issue-refused-unverified'), /Permissions could not be verified\. Financial actions are temporarily unavailable\./);
    assert.ok(!u.by('calls-preview-continue'));
  } finally { await u.close(); }
});

test('a fund with nothing committed is told to add LPs, and no call form is drawn', async () => {
  const m = await mount(SUPER, stubs({ ledger: async () => LEDGER(0) }));
  try {
    await m.click('calls-new');
    assert.match(m.text('calls-new-no-commitments'), /Example Fund I has no committed capital\. A capital call needs commitments\. Add LPs first\./);
    assert.equal(m.props('calls-new-add-lps').href, '/admin/fund-admin/lps?add=1&fund=7');
    assert.ok(!m.by('calls-new-form'));
  } finally { await m.close(); }
});
