/**
 * D714 (#1779) PR 4a — the fund administration console at /admin/fund-admin:
 * each tab on its fixture, the controls a plain Admin and the Super Admin
 * each get from the act table, the empty / Not recorded / Unreadable states,
 * and the two shell rows with a branch admin's notice.
 *
 * Every account ending, id and amount here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_console_d714.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { TABS, tabFrom, tabFlags, HQ_ONLY, PAYMENT_INSTRUCTIONS_ADMIN } from '../src/pages/admin/fundAdmin/fundAdminModel.js';
import { Table } from '../src/pages/admin/fundAdmin/parts.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const h = React.createElement;
const APP = readFileSync(resolve('frontend/src/App.jsx'), 'utf8');

const SUPER_ACTS = ['capital_call.issue', 'distribution.execute', 'fund_report.issue', 'fee_terms.confirm', 'fee_period.issue', 'mercury.connection', 'bank_account.see', 'bank_account.change', 'bank_account.reveal'];
const ADMIN_ACTS = ['capital_call.preview', 'capital_call.receipt', 'distribution.preview', 'distribution.mark_paid', 'fee.write', 'mercury.sync', 'mercury.reconcile'];
const SENTENCE = {
  'capital_call.issue': 'A Super Admin issues capital calls.',
  'distribution.execute': 'A Super Admin executes distributions.',
  'fund_report.issue': 'A Super Admin issues fund reports.',
  'fee_terms.confirm': "A Super Admin confirms a fund's fee terms.",
  'fee_period.issue': 'A Super Admin issues fee periods.',
};
const access = (superAdmin) => ({
  super_admin: superAdmin,
  acts: [
    ...SUPER_ACTS.map((act) => ({ act, tier: 'super_admin', allowed: superAdmin, sentence: SENTENCE[act] || `A Super Admin does ${act}.` })),
    ...ADMIN_ACTS.map((act) => ({ act, tier: 'admin', allowed: true, sentence: null })),
  ],
});

const OVERVIEW = () => ({
  as_of: '2026-10-18',
  entities: { state: 'ok', items: [
    { entity_key: 'holdings', name: 'Axal Holdings', state: 'ok', reason: null,
      connection: { status: 'active', org_name: 'Holdings Org', last_synced_at: '2026-10-18T05:00:00Z', last_error: null },
      accounts: [{ uid: 'acc-1', kind: 'checking', ending: '9001', nickname: 'Operating', current_cents: 1234567, available_cents: 1200000, balance_read_at: '2026-10-18T05:00:00Z' }], payment_accounts: 1 },
    { entity_key: 'fund', name: 'Axal Fund I', state: 'not_recorded', reason: 'No Mercury connection', connection: null, accounts: [], payment_accounts: 0 },
  ] },
  funds: { state: 'ok', items: [
    { fund_id: 7, name: 'Example Fund I', committed_cents: 50000000, called_cents: 10000000, received_cents: 7500000, outstanding_cents: 2500000, overdue_lines: 2, next_due_date: '2026-11-01' },
    { fund_id: 8, name: 'Example Fund II', committed_cents: 0, called_cents: 0, received_cents: 0, outstanding_cents: 0, overdue_lines: 0, next_due_date: null },
  ] },
  fees: { state: 'ok', items: [
    { fund_id: 7, state: 'ok', reason: null, quarter: '2026Q3', status: 'issued', net_cents: 250000, issued_at: '2026-10-02' },
    { fund_id: 8, state: 'not_recorded', reason: 'No fee period yet', quarter: null, status: null, net_cents: null, issued_at: null },
  ] },
  drafts: { state: 'ok', items: [{ fund_id: 7, entity_key: null, draft: 1, prepared: 2 }] },
  matches: { state: 'ok', items: [{ fund_id: 7, proposed: 3, needs_review: 1 }] },
});
const CONNECTIONS = () => ({ ok: true, entities: [
  { entity_key: 'holdings', connection: { status: 'active', mercury_org_name: 'Holdings Org', last_synced_at: '2026-10-18T05:00:00Z', last_error: null, accounts: [{ kind: 'checking', last_four: '9001' }] } },
  { entity_key: 'fund', connection: null },
] });
const MATCHES = () => ({ ok: true, items: [
  { uid: 'm-prop', target_kind: 'capital_call_line', target_id: 11, state: 'proposed', amount_cents: 100000, posted_on: '2026-10-05', counterparty_name: 'LP <b>One</b>', entity_key: 'fund', last_four: '9004' },
  { uid: 'm-rev', target_kind: 'fee_period', target_id: 41, state: 'needs_review', amount_cents: 250000, posted_on: '2026-10-06', counterparty_name: 'Axal Fund I', entity_key: 'gp', last_four: '9005' },
] });
const FEES = () => ({
  terms: [{ uid: 'terms-1', annual_bps: 200, effective_from: '2026-01-01', lpa_reference: 'LPA §8', status: 'draft' }],
  lps: [{ id: 1, admission_missing: true }, { id: 2, admission_missing: false }],
  periods: [{ quarter: '2026Q3', window_start: '2026-07-01', window_end: '2026-09-30', status: 'issued', net_cents: 250000, remittance_reference: 'FEE-2026Q3' }],
});
const DRAFTS = () => ({ items: [{ uid: 'a'.repeat(32), kind: 'lp_quarterly_report', period_label: 'Q3 2026', status: 'prepared', revision: 1, fund_id: 7, report_period_id: 3, prepared_at: '2026-10-10' }] });

function stubs(over = {}) {
  const calls = [];
  const rec = (name, fallback) => (...args) => { calls.push([name, ...args]); return (over[name] || fallback)(...args); };
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', async () => access(false)),
        overview: rec('overview', async () => OVERVIEW()),
        distributionPreview: rec('distributionPreview', async (fundId, cents) => ({
          ok: true, fund_id: fundId, proceeds_cents: cents, distributable: true, basis_returned_cents: cents / 2, profit_cents: cents / 2,
          carry_rate: 0.2, carry_rate_defaulted: true, carry_withheld_cents: cents / 10, distributable_cents: cents - cents / 10,
          distribution_type: 'exit_proceeds', lines: [{ lp_id: 1, amount_cents: cents - cents / 10 - 1 }], dropped_lp_ids: [2], unallocated_cents: 1,
        })),
      },
      mercury: {
        connections: rec('connections', async () => CONNECTIONS()),
        connect: rec('connect', async () => ({ ok: true })),
        disconnect: rec('disconnect', async () => ({ ok: true })),
        sync: rec('sync', async () => ({ ok: true })),
        accounts: rec('accounts', async () => ({ ok: true, items: [{ uid: 'acc-1', entity_key: 'holdings', kind: 'checking', last_four: '9001', nickname: 'Operating', registered: true, current: { cents: 1234567, reason: null }, available: { cents: null, reason: 'unreadable' }, balance_read_at: '2026-10-18T05:00:00Z' }] })),
        transactions: rec('transactions', async () => ({ ok: true, page: 1, page_size: 50, total: 51, items: [{ uid: 't-1', amount_cents: 100000, created_on: '2026-10-05', posted_on: '2026-10-05', counterparty_name: 'LP One', last_four: '9004', status: 'sent', match: null }] })),
        matches: rec('matches', async () => MATCHES()),
        proposeMatch: rec('proposeMatch', async () => ({ ok: true })),
        confirmMatch: rec('confirmMatch', async () => ({ ok: true })),
        rejectMatch: rec('rejectMatch', async () => ({ ok: true })),
        markNotOurs: rec('markNotOurs', async () => ({ ok: true, uid: 'mk-new' })),
        withdrawNotOurs: rec('withdrawNotOurs', async () => ({ ok: true })),
      },
      fees: {
        state: rec('feeState', async () => FEES()),
        confirmTerms: rec('confirmTerms', async () => ({ ok: true })),
        previewPeriod: rec('previewPeriod', async (fundId, q) => ({ quarter: q, status: 'draft', digest: 'd'.repeat(64), totals: { gross_cents: 260000, catch_up_cents: 0, applied_cents: 10000, net_cents: 250000 } })),
        issuePeriod: rec('issuePeriod', async () => ({ ok: true })),
      },
      reporting: {
        list: rec('reportingList', async () => DRAFTS()),
        read: rec('reportingRead', async () => ({ draft: DRAFTS().items[0], figures: {}, figures_sha256: 'f'.repeat(64) })),
        exportCsv: rec('exportCsv', async () => undefined),
        prepare: rec('prepare', async () => ({ ok: true })),
        returnDraft: rec('returnDraft', async () => ({ ok: true })),
        issue: rec('issue', async () => ({ ok: true })),
      },
      // D752 (#1890): the Calls tab's proofs of funds, read only on Show.
      capitalAttestations: {
        forFund: rec('forFund', async () => ({ ok: true, today: '2026-10-18', truncated: false, fund_id: 7, items: [
          { uid: 'pf-1', purpose: 'lp_commitment', target_id: 301, deal_id: null, fund_id: 7, investor_user_id: 30, investor_name: 'LP One', target_label: 'Fund I commitment',
            state: 'active', label: 'Active', expired: false, amount_floor_cents: 25000000, as_of: '2026-10-18', expires_on: '2026-11-17', holder_name: 'Own Practice LLC',
            accounts_counted: 2, shared_on: '2026-10-18', statement: 'At least $250,000 available at Mercury on 2026-10-18, held by Own Practice LLC, across 2 accounts. Shared by the investor on 2026-10-18.',
            other_active: [], other_active_count: 0 },
          { uid: 'pf-2', purpose: 'lp_application', target_id: 202, deal_id: null, fund_id: 7, investor_user_id: 31, investor_name: 'LP Two', target_label: 'Fund I application',
            state: 'revoked', label: 'Revoked', revoked_on: '2026-10-12', statement: 'Revoked by the investor on 2026-10-12.' },
        ] })),
      },
      funds: {
        distributions: rec('distributions', async () => ({ ok: true, items: [{ id: 91, lp_id: 1, lp_name: 'LP One', amount_cents: 450000, status: 'pending', distribution_type: 'exit_proceeds', created_at: '2026-10-01' }] })),
        execute: rec('execute', async () => ({ ok: true })),
        markPaid: rec('markPaid', async () => ({ ok: true })),
      },
    },
  };
}

const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };

async function mount(user, apis, url = '/admin/fund-admin') {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user, apis }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const ids = () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    by, ids, settle, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); },
    async submit(n) { await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await settle(); },
    form(id) { let n = need(id); const all = walk(container); const up = (x) => all.find((p) => (p.childNodes || []).includes(x)); while (n && n.tagName?.toLowerCase() !== 'form') n = up(n); return n; },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

/** Mount one tab and take the steps that reveal its gated controls. */
async function open(user, tab, s = stubs({ access: async () => access(Number(user.is_super_admin) === 1) })) {
  const m = await mount(user, s.apis, `/admin/fund-admin?tab=${tab}&fund=7`);
  if (tab === 'distributions') {
    await m.type('distribution-proceeds', '1000.00');
    await m.submit(m.form('distribution-preview-submit'));
  }
  if (tab === 'fees') {
    await m.type('fee-quarter', '2026Q4');
    await m.submit(m.form('fee-preview-submit'));
  }
  if (tab === 'reports') await m.click(`draft-open-${'a'.repeat(32)}`);
  return { m, s };
}

// ------------------------------------------------------------------ each tab on its fixture

test('the tabs are decision 7\'s, in order, and ?tab= picks one', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Banking', 'Reconciliation', 'Capital calls', 'Distributions', 'Management fees', 'Reports']);
  assert.equal(tabFrom('fees'), 'fees');
  assert.equal(tabFrom('nonsense'), 'overview');
  assert.equal(tabFrom(null), 'overview');
});

test('each tab renders its fixture', async () => {
  const expect = {
    overview: ['Axal Holdings', 'Checking · ending 9001 · Operating', '$12,345.67', 'Example Fund I', '2 overdue', '2026Q3 · issued', '1 draft · 2 prepared', '3 proposed · 1 need review'],
    banking: ['Holdings Org', 'ending 9001', 'Current $12,345.67', 'Available Unreadable', 'Page 1 of 2', 'LP One'],
    reconciliation: ['$1,000.00 · Capital-call line #11', 'Fee period #41', 'Needs review'],
    calls: ['Example Fund I · capital calls', '$100,000.00 of $500,000.00 committed', 'Open the call ledger', 'Open the books', 'Proof of funds shared by LPs', 'Show proofs of funds'],
    distributions: ['Carry withheld', 'the job’s 20% default', '1 LP share rounded to zero', 'LP One', '$4,500.00'],
    fees: ['2% a year from 2026-01-01', '1 LP has no admission date recorded', '2026Q3 · net $2,500.00', '2026Q4 · net $2,500.00'],
    reports: ['Q3 2026 · lp quarterly report', 'prepared', 'Opened, and recorded in the audit log'],
  };
  for (const [tab, words] of Object.entries(expect)) {
    const { m, s } = await open(SUPER, tab);
    const text = m.text();
    assert.ok(m.by(`fund-admin-panel-${tab}`), `${tab} panel`);
    for (const w of words) assert.ok(text.includes(w), `${tab}: missing "${w}" in: ${text.slice(0, 400)}`);
    assert.ok(!s.calls.some(([n]) => n === 'forFund'), `${tab}: no proof of funds read before Show`);
    await m.unmount();
  }
  // Bank text is drawn as text: the counterparty's markup is never parsed.
  const { m } = await open(SUPER, 'reconciliation');
  assert.ok(m.text().includes('LP <b>One</b>'));
  await m.unmount();
});

// ------------------------------------------------------------------ controls by role

const GATED = (uid = 'a'.repeat(32)) => [
  'mercury-connect-fund', 'mercury-replace-holdings', 'mercury-disconnect-holdings', 'payment-instructions-link',
  'calls-issue-allowed', 'distribution-execute', 'fee-terms-confirm-terms-1', 'fee-issue', `draft-issue-${uid}`,
];
const REFUSED = (uid = 'a'.repeat(32)) => ['payment-instructions-admin', 'calls-issue-refused', 'distribution-execute-refused', 'fee-terms-refused-terms-1', 'fee-issue-refused', `draft-issue-refused-${uid}`];

async function idsAcross(user) {
  const seen = new Set();
  let text = '';
  for (const tab of ['banking', 'reconciliation', 'calls', 'distributions', 'fees', 'reports']) {
    const { m } = await open(user, tab);
    for (const id of m.ids()) seen.add(id);
    text += ` ${m.text()}`;
    await m.unmount();
  }
  return { seen, text };
}

test('a plain Admin gets no Connect, Disconnect, Reveal, Issue, Execute or fee-terms Confirm, and does get the match Confirm and Reject', async () => {
  const { seen, text } = await idsAcross(ADMIN);
  for (const id of GATED()) assert.ok(!seen.has(id), `a plain Admin sees ${id}`);
  for (const id of REFUSED()) assert.ok(seen.has(id), `a plain Admin lacks the sentence ${id}`);
  for (const s of Object.values(SENTENCE)) assert.ok(text.includes(s), `missing "${s}"`);
  assert.ok(text.includes(PAYMENT_INSTRUCTIONS_ADMIN));
  assert.doesNotMatch(text, /\bReveal\b/);
  assert.ok(seen.has('match-confirm-m-prop') && seen.has('match-reject-m-prop') && seen.has('match-reject-m-rev'));
  assert.ok(!seen.has('match-confirm-m-rev'), 'a match that needs review is rejected, never confirmed');
  assert.ok(seen.has('distribution-mark-paid-91') && seen.has('fee-preview-submit') && seen.has('distribution-preview-submit'));
});

test('the Super Admin holds every control, and none of the sentences', async () => {
  const { seen } = await idsAcross(SUPER);
  for (const id of GATED()) assert.ok(seen.has(id), `the Super Admin lacks ${id}`);
  for (const id of REFUSED()) assert.ok(!seen.has(id), `the Super Admin sees the sentence ${id}`);
  assert.ok(seen.has('match-confirm-m-prop'));
});

test('a failed access read keeps every control, and says so; the Worker still decides', async () => {
  const s = stubs({ access: async () => { throw Object.assign(new Error('down'), { status: 500 }); } });
  const { m } = await open(ADMIN, 'distributions', s);
  assert.ok(m.by('fund-admin-access-unreadable'));
  assert.ok(m.by('distribution-execute'));
  await m.unmount();
});

test('the gated acts call what they name, with the previewed figures', async () => {
  const { m, s } = await open(SUPER, 'distributions');
  await m.click('distribution-execute');
  assert.deepEqual(s.calls.find((c) => c[0] === 'execute'), ['execute', { fund_id: 7, proceeds_cents: 100000 }]);
  await m.click('distribution-mark-paid-91');
  assert.deepEqual(s.calls.find((c) => c[0] === 'markPaid'), ['markPaid', 91]);
  await m.unmount();
  const fees = await open(SUPER, 'fees');
  await fees.m.click('fee-issue');
  assert.deepEqual(fees.s.calls.find((c) => c[0] === 'issuePeriod'), ['issuePeriod', 7, '2026Q4', 'd'.repeat(64)]);
  await fees.m.click('fee-terms-confirm-terms-1');
  assert.deepEqual(fees.s.calls.find((c) => c[0] === 'confirmTerms'), ['confirmTerms', 7, 'terms-1']);
  await fees.m.unmount();
  const rec = await open(ADMIN, 'reconciliation');
  await rec.m.click('match-confirm-m-prop');
  assert.deepEqual(rec.s.calls.find((c) => c[0] === 'confirmMatch'), ['confirmMatch', 'm-prop']);
  await rec.m.click('match-reject-m-rev');
  await rec.m.type('match-reason-m-rev', 'too short');
  assert.equal(rec.m.by('match-reject-submit-m-rev') && Object.entries(rec.m.by('match-reject-submit-m-rev')).find(([k]) => k.startsWith('__reactProps$'))[1].disabled, true, 'a reason under ten characters cannot be sent');
  await rec.m.type('match-reason-m-rev', 'Not this LP’s wire at all');
  await rec.m.submit(rec.m.form('match-reason-m-rev'));
  assert.deepEqual(rec.s.calls.find((c) => c[0] === 'rejectMatch'), ['rejectMatch', 'm-rev', 'Not this LP’s wire at all']);
  await rec.m.unmount();
  const rep = await open(SUPER, 'reports');
  await rep.m.click(`draft-issue-${'a'.repeat(32)}`);
  await rep.m.submit(rep.m.form(`draft-text-${'a'.repeat(32)}`));
  assert.deepEqual(rep.s.calls.find((c) => c[0] === 'issue'), ['issue', 'a'.repeat(32), { figures_sha256: 'f'.repeat(64), acknowledgement: undefined }]);
  await rep.m.unmount();
});

// ------------------------------------------------------------------ empty, Not recorded, Unreadable

test('Not recorded is the store\'s own reason, never a zero', async () => {
  const { m } = await open(SUPER, 'overview');
  const fund = m.text(m.by('overview-entity-fund'));
  assert.ok(fund.includes('No Mercury connection'), fund);
  assert.ok(m.text().includes('No fee period yet'));
  assert.ok(m.text().includes('No line due'), 'a fund with no due line says so');
  await m.unmount();
});

test('the empty states render', async () => {
  const s = stubs({
    matches: async () => ({ ok: true, items: [] }),
    reportingList: async () => ({ items: [] }),
    distributions: async () => ({ ok: true, items: [] }),
    overview: async () => ({ ...OVERVIEW(), funds: { state: 'ok', items: [] } }),
  });
  const rec = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=reconciliation');
  assert.ok(rec.text().includes('No match yet'));
  await rec.unmount();
  for (const tab of ['calls', 'distributions', 'fees', 'reports']) {
    const m = await mount(ADMIN, s.apis, `/admin/fund-admin?tab=${tab}`);
    assert.ok(m.by('no-administered-fund'), `${tab} with no administered fund`);
    await m.unmount();
  }
  const ov = await mount(ADMIN, s.apis, '/admin/fund-admin');
  assert.ok(ov.text().includes('No administered fund'));
  await ov.unmount();
  const d = stubs({ distributions: async () => ({ ok: true, items: [] }), reportingList: async () => ({ items: [] }) });
  const dm = await mount(ADMIN, d.apis, '/admin/fund-admin?tab=distributions&fund=7');
  assert.ok(dm.text().includes('No distribution yet'));
  await dm.unmount();
});

test('Unreadable: the overview\'s 503 says nothing was read, one failed block blanks only itself, and a failed Banking read says so', async () => {
  const audit = stubs({ overview: async () => { throw Object.assign(new Error('audit'), { status: 503 }); } });
  const a = await mount(ADMIN, audit.apis);
  assert.ok(a.by('overview-unreadable'));
  assert.ok(a.text().includes('Nothing was read, because its audit row could not be written.'));
  assert.doesNotMatch(a.text(), /\$0\.00/);
  await a.unmount();
  const block = stubs({ overview: async () => ({ ...OVERVIEW(), drafts: { state: 'unreadable', items: [] } }) });
  const b = await mount(ADMIN, block.apis);
  assert.ok(b.by('overview-drafts-unreadable'));
  assert.ok(!b.by('overview-matches-unreadable') && b.text().includes('3 proposed'), 'the other blocks still draw');
  await b.unmount();
  const bank = stubs({ accounts: async () => { throw Object.assign(new Error('audit'), { status: 503 }); }, transactions: async () => { throw new Error('down'); } });
  const c = await mount(ADMIN, bank.apis, '/admin/fund-admin?tab=banking');
  assert.ok(c.text().includes('The entity accounts could not be read. Nothing was read, because its audit row could not be written.'));
  assert.ok(c.text().includes('The transactions could not be read.'));
  await c.unmount();
});

// ------------------------------------------------------------------ the doors, and a branch

test('the two shell rows lead to the route, which is guard([\'admin\']) and not hqOnly', () => {
  const hq = SIDEBAR_GROUPS.super_admin.flatMap((g) => g.items);
  const admin = SIDEBAR_GROUPS.admin.flatMap((g) => g.items);
  const at = (rows, label) => rows.findIndex((r) => r.label === label);
  assert.equal(hq[at(hq, 'Fund admin')]?.to, '/admin/fund-admin');
  assert.equal(at(hq, 'Fund admin'), at(hq, 'Funds') + 1, 'after Funds in the HQ shell');
  assert.equal(admin[at(admin, 'Fund admin')]?.to, '/admin/fund-admin');
  assert.equal(at(admin, 'Fund admin'), at(admin, 'Contracts') + 1, 'after Contracts in the Admin shell');
  const line = APP.split('\n').find((l) => l.includes('path="/admin/fund-admin"'));
  assert.ok(line, 'the route is registered');
  assert.match(line, /guard\(\['admin'\], <FundAdminConsole \/>\)/);
  assert.doesNotMatch(line, /hqOnly\(/);
  assert.match(APP, /lazy\(\(\) => import\('\.\/pages\/admin\/fundAdmin\/FundAdminConsole'\)\)/);
});

test('D752: the Calls tab reads the LPs\' proofs of funds only on Show; Hide then Show reads again', async () => {
  const { m, s } = await open(ADMIN, 'calls');
  try {
    assert.ok(!m.by('calls-proofs-hide'));
    await m.click('calls-proofs-show');
    assert.deepEqual(s.calls.filter(([n]) => n === 'forFund'), [['forFund', 7]]);
    const text = m.text();
    assert.ok(text.includes('LP One · Fund I commitment') && text.includes('At least $250,000 available at Mercury'));
    assert.ok(text.includes('Revoked by the investor on 2026-10-12.'));
    assert.ok(text.includes("Compare with the LP's uncalled commitment on the call ledger."));
    const revoked = text.slice(text.indexOf('LP Two'));
    assert.ok(!/\$/.test(revoked.slice(0, revoked.indexOf('Revoked by the investor') + 40)), 'a revoked proof shows no amount');
    await m.click('calls-proofs-hide');
    assert.ok(m.by('calls-proofs-show'));
    await m.click('calls-proofs-show');
    assert.equal(s.calls.filter(([n]) => n === 'forFund').length, 2);
  } finally { await m.unmount(); }
});

test('a branch admin sees the HQ-only notice and the console makes no read', async () => {
  const s = stubs();
  for (const tab of ['overview', 'banking', 'calls']) {
    const m = await mount({ ...SUPER, branch: { code: 'ldn' } }, s.apis, `/admin/fund-admin?tab=${tab}`);
    assert.ok(m.by('fund-admin-branch'));
    assert.ok(m.text().includes(HQ_ONLY));
    assert.ok(!m.by(`fund-admin-panel-${tab}`));
    await m.unmount();
  }
  assert.deepEqual(s.calls, [], 'no read at all');
});

test('#1780 decision 12: the entity sheet on Connectors opens this console\'s Banking tab; a branch admin\'s does not', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MercuryEntitySheet } = await import('../src/pages/account/MercurySheet.jsx');
  const api = { connections: async () => CONNECTIONS() };
  const p = { key: 'mercury', display_name: 'Mercury' };
  const page = renderToStaticMarkup(h(MemoryRouter, null, h(MercuryEntitySheet, { p, api, onClose() {} })));
  assert.match(page, /href="\/admin\/fund-admin\?tab=banking"[^>]*>Open Banking</);
  const branch = renderToStaticMarkup(h(MemoryRouter, null, h(MercuryEntitySheet, { p, api, branch: 'ldn', onClose() {} })));
  assert.doesNotMatch(branch, /Open Banking/);
});

// ------------------------------------------------------------------ D749: Not ours

const NOT_OURS_FIXTURE = ({ match } = {}) => {
  const credit = { uid: 'tc-1', amount_cents: 250000, created_on: '2026-10-07', posted_on: '2026-10-07', counterparty_name: 'Unknown <i>Sender</i>', entity_key: 'fund', last_four: '9004', status: 'sent', match: null, not_ours: null };
  const debit = { ...credit, uid: 'td-1', amount_cents: -5000 };
  const review = { ...credit, uid: 'tr-1', not_ours: { uid: 'mk-review', reason: 'duplicate', note: null, state: 'needs_review', marked_at: '2026-10-08' } };
  const active = { ...credit, uid: 'ta-1', not_ours: { uid: 'mk-active', reason: 'other_entity', note: 'Belongs to <b>GP</b>', state: 'active', marked_at: '2026-10-08' } };
  const items = match === 'none' ? [credit, debit, review] : match === 'not_ours' ? [active, review] : [credit, active];
  return { ok: true, page: 1, page_size: 50, total: items.length, items };
};
const notOursStubs = (over = {}) => stubs({ transactions: async (q) => NOT_OURS_FIXTURE(q), ...over });

test('D749: the reasons are the Worker\'s keys, in its order, and the pill names the reason or the review', async () => {
  const { NOT_OURS_REASONS, notOursText } = await import('../src/pages/admin/fundAdmin/fundAdminModel.js');
  const worker = readFileSync(resolve('cloudflare-worker/src/services/mercury/notOurs.ts'), 'utf8');
  const keys = [...worker.slice(worker.indexOf('NOT_OURS_REASONS'), worker.indexOf('] as const')).matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(NOT_OURS_REASONS.map(([k]) => k), keys);
  assert.equal(keys.length, 4);
  assert.equal(notOursText({ reason: 'duplicate', state: 'active' }), 'Not ours · Duplicate');
  assert.equal(notOursText({ reason: 'duplicate', state: 'needs_review' }), 'Not ours · needs review');
  assert.equal(notOursText(null), null);
});

test('D749: Unmatched credits lists credits only; Not ours posts { reason, note } and needs a note for Other', async () => {
  const s = notOursStubs();
  const m = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=reconciliation');
  assert.ok(m.by('unmatched-tc-1') && !m.by('unmatched-td-1'), 'a debit is never offered');
  assert.ok(m.by('unmatched-tr-1') && !m.by('not-ours-tr-1'), 'a line in review shows its pill, with no second mark');
  assert.ok(m.text(m.by('unmatched-tr-1')).includes('Not ours · needs review'));
  assert.ok(m.text().includes('Unknown <i>Sender</i>'), 'bank text is drawn as text');
  await m.click('not-ours-tc-1');
  await m.type('not-ours-reason-tc-1', 'other');
  await m.type('not-ours-note-tc-1', 'too short');
  const submit = () => Object.entries(m.by('not-ours-submit-tc-1')).find(([k]) => k.startsWith('__reactProps$'))[1];
  assert.equal(submit().disabled, true, 'Other needs a note of ten characters');
  await m.type('not-ours-note-tc-1', 'A wire meant for another fund');
  assert.equal(submit().disabled, false);
  const before = s.calls.filter((c) => c[0] === 'transactions').length;
  await m.submit(m.by('not-ours-form-tc-1'));
  assert.deepEqual(s.calls.find((c) => c[0] === 'markNotOurs'), ['markNotOurs', 'tc-1', { reason: 'other', note: 'A wire meant for another fund' }]);
  assert.ok(s.calls.filter((c) => c[0] === 'transactions').length > before, 'both groups reload after the act');
  await m.unmount();
  // A reason other than Other posts with no note.
  const t = notOursStubs();
  const n = await mount(ADMIN, t.apis, '/admin/fund-admin?tab=reconciliation');
  await n.click('not-ours-tc-1');
  await n.submit(n.by('not-ours-form-tc-1'));
  assert.deepEqual(t.calls.find((c) => c[0] === 'markNotOurs'), ['markNotOurs', 'tc-1', { reason: 'not_fund_transaction', note: undefined }]);
  await n.unmount();
});

test('D749: the Not ours group offers Withdraw only, with a ten-character reason; a refusal shows the Worker\'s sentence', async () => {
  const s = notOursStubs({ withdrawNotOurs: async () => { throw Object.assign(new Error('This mark is already withdrawn.'), { status: 409 }); } });
  const m = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=reconciliation');
  const row = m.by('not-ours-mark-mk-active');
  assert.ok(row && m.by('not-ours-mark-mk-review'));
  assert.ok(m.text(row).includes('Not ours · Belongs to another entity') && m.text(row).includes('Belongs to <b>GP</b>'));
  assert.ok(!m.ids().some((id) => /^(match-confirm|not-ours-submit)-.*mk-/.test(id)), 'no Confirm on a mark');
  await m.click('not-ours-withdraw-mk-active');
  await m.type('not-ours-withdraw-reason-mk-active', 'short');
  const btn = () => Object.entries(m.by('not-ours-withdraw-submit-mk-active')).find(([k]) => k.startsWith('__reactProps$'))[1];
  assert.equal(btn().disabled, true);
  await m.type('not-ours-withdraw-reason-mk-active', 'It was ours after all');
  await m.submit(m.form('not-ours-withdraw-reason-mk-active'));
  assert.deepEqual(s.calls.find((c) => c[0] === 'withdrawNotOurs'), ['withdrawNotOurs', 'mk-active', 'It was ours after all']);
  assert.ok(m.text().includes('This mark is already withdrawn.'));
  await m.unmount();
});

test('D749: with mercury.reconcile refused, the Not ours and Withdraw buttons give way to the sentence', async () => {
  const refused = { super_admin: false, acts: [{ act: 'mercury.reconcile', tier: 'admin', allowed: false, sentence: 'An Admin reconciles bank lines.' }] };
  const s = notOursStubs({ access: async () => refused });
  const m = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=reconciliation');
  assert.ok(!m.by('not-ours-tc-1') && m.by('not-ours-refused-tc-1'));
  assert.ok(!m.by('not-ours-withdraw-mk-active') && m.by('not-ours-withdraw-refused-mk-active'));
  await m.unmount();
});

test('D749: the Transactions pill reads the mark for a marked line', async () => {
  const s = notOursStubs();
  const m = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=banking');
  assert.ok(m.text().includes('Not ours · Belongs to another entity'));
  assert.ok(m.text().includes('Unmatched'));
  await m.unmount();
});

// ------------------------------------------------------------------ the canvas PR's layout (S1's brief, 2026-10-18)

test('canvas: the chrome names the viewer\'s profile and the overview\'s date, with no "laid out from existing parts" note', async () => {
  for (const [user, role] of [[ADMIN, 'Admin'], [SUPER, 'Super Admin']]) {
    const { m } = await open(user, 'overview');
    assert.equal(m.text(m.by('fund-admin-role')), role);
    assert.equal(m.text(m.by('fund-admin-as-of')), 'As of 2026-10-18');
    assert.ok(!m.by('fund-admin-layout-note'));
    assert.doesNotMatch(m.text(), /laid out from existing parts/);
    await m.unmount();
  }
  const s = stubs({ access: async () => { throw new Error('down'); } });
  const m = await mount(ADMIN, s.apis);
  assert.ok(!m.by('fund-admin-role'), 'no profile is claimed when the act table could not be read');
  await m.unmount();
});

test('canvas: the tabs carry the amber count flags from the overview, and a block that is not ok flags nothing', async () => {
  assert.deepEqual(tabFlags(OVERVIEW()), { calls: 2, reconciliation: 4, reports: 2 });
  const bad = { ...OVERVIEW(), funds: { state: 'unreadable', items: [{ fund_id: 7, overdue_lines: 9 }] }, matches: { state: 'unreadable', items: [{ fund_id: 7, proposed: 5, needs_review: 0 }] } };
  assert.deepEqual(tabFlags(bad), { calls: 0, reconciliation: 0, reports: 2 });
  assert.deepEqual(tabFlags(null), { calls: 0, reconciliation: 0, reports: 0 });
  const { m } = await open(ADMIN, 'overview');
  assert.equal(m.text(m.by('fund-admin-flag-reconciliation')), '4');
  assert.equal(m.text(m.by('fund-admin-flag-calls')), '2');
  assert.equal(m.text(m.by('fund-admin-flag-reports')), '2');
  assert.ok(!m.by('fund-admin-flag-fees') && !m.by('fund-admin-flag-banking'));
  await m.unmount();
});

test('canvas Overview: each entity card names its Mercury state, and each fund row carries its fee period, drafts and matches', async () => {
  const { m } = await open(ADMIN, 'overview');
  assert.ok(m.text(m.by('overview-entity-holdings')).includes('Connected'));
  assert.ok(m.text(m.by('overview-entity-fund')).includes('Not connected'));
  assert.ok(m.text(m.by('overview-entity-no-account-fund')).includes('No bank account yet'));
  const row = m.text(m.by('overview-fund-7'));
  for (const w of ['$500,000.00', '$100,000.00', '$75,000.00', '$25,000.00', '2 overdue', '2026-11-01', '2026Q3 · issued · net $2,500.00', '1 draft · 2 prepared', '3 proposed · 1 need review']) {
    assert.ok(row.includes(w), `fund 7 row lacks "${w}": ${row}`);
  }
  const other = m.text(m.by('overview-fund-8'));
  assert.ok(other.includes('No fee period yet') && other.includes('No line due'), other);
  await m.click('overview-open-7');
  assert.ok(m.by('fund-admin-panel-calls'), 'a fund opens on its Capital calls');
  await m.unmount();
  const s = stubs({ overview: async () => ({ ...OVERVIEW(), fees: { state: 'unreadable', items: [] } }) });
  const u = await mount(ADMIN, s.apis);
  assert.ok(m.text !== undefined && u.by('overview-fees-unreadable'));
  assert.ok(u.text(u.by('overview-fund-7')).includes('Unreadable'), 'the failed block\'s column says so');
  assert.ok(u.text(u.by('overview-fund-7')).includes('1 draft · 2 prepared'), 'the other blocks still draw');
  await u.unmount();
  const e = stubs({ overview: async () => ({ ...OVERVIEW(), entities: { state: 'ok', items: [{ ...OVERVIEW().entities.items[0], connection: { status: 'error', org_name: 'Holdings Org', last_synced_at: null, last_error: 'unauthorized' } }] } }) });
  const n = await mount(ADMIN, e.apis);
  assert.ok(n.text(n.by('overview-entity-holdings')).includes('Needs attention'));
  assert.ok(n.text(n.by('overview-entity-error-holdings')).includes('Mercury refused the token'));
  await n.unmount();
});

test('canvas Reconciliation: matches sit in the brief\'s groups by state, each with its count', async () => {
  const s = stubs({ matches: async () => ({ ok: true, items: [...MATCHES().items, { uid: 'm-ok', target_kind: 'capital_call_line', target_id: 12, state: 'confirmed', amount_cents: 5000, posted_on: '2026-10-01', counterparty_name: 'LP Two', entity_key: 'fund', last_four: '9004' }] }) });
  const { m } = await open(ADMIN, 'reconciliation', s);
  assert.ok(m.by('matches-proposed') && m.text(m.by('matches-proposed')).includes('Proposed · 1'));
  assert.ok(m.text(m.by('matches-proposed')).includes('Capital-call line #11'));
  assert.ok(m.text(m.by('matches-needs_review')).includes('Fee period #41'));
  assert.ok(m.text(m.by('matches-confirmed')).includes('Capital-call line #12'));
  assert.ok(m.text(m.by('matches-rejected')).includes('None rejected.'));
  assert.deepEqual(s.calls.filter(([n]) => n === 'matches').map(([, q]) => q), [{}], 'one read of every state');
  await m.unmount();
});

test('canvas Not ours: the action opens a dialog, and the dialog is the shared Lightbox', async () => {
  const s = notOursStubs();
  const m = await mount(ADMIN, s.apis, '/admin/fund-admin?tab=reconciliation');
  assert.ok(!m.by('not-ours-dialog-tc-1'));
  await m.click('not-ours-tc-1');
  const dialog = m.by('not-ours-dialog-tc-1');
  assert.ok(dialog, 'a dialog');
  assert.equal(dialog.getAttribute?.('role') ?? Object.entries(dialog).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.role, 'dialog');
  assert.ok(m.text(dialog).includes('$2,500.00 from Unknown <i>Sender</i>'), 'the credit, as text');
  await m.click('not-ours-dialog-tc-1-close');
  assert.ok(!m.by('not-ours-dialog-tc-1'), 'Close takes it away and marks nothing');
  assert.ok(!s.calls.some(([n]) => n === 'markNotOurs'));
  await m.unmount();
});

test('canvas Distributions: the proceeds card holds Execute, and the per-LP total is the sum of the lines', async () => {
  const { m } = await open(SUPER, 'distributions');
  const preview = m.text(m.by('distribution-preview'));
  for (const w of ['Where every cent goes', 'Proceeds', 'Basis returned', 'Profit', 'Carry withheld', 'To the LPs', 'No line received', 'Per-LP distribution preview']) {
    assert.ok(preview.includes(w), `missing "${w}"`);
  }
  // 1000.00 proceeds: carry $100.00, one line of $899.99, one cent unallocated.
  assert.ok(m.text(m.by('distribution-line-1')).includes('$899.99'));
  assert.match(preview, /Total \$899\.99/);
  assert.ok(m.by('distribution-execute'));
  await m.unmount();
  // A preview without its rate says so; it never prints NaN.
  const r = stubs({ distributionPreview: async (fundId, cents) => ({ ok: true, fund_id: fundId, proceeds_cents: cents, distributable: false, lines: [], unallocated_cents: 0 }) });
  const { m: n } = await open(SUPER, 'distributions', r);
  assert.ok(n.text(n.by('distribution-preview')).includes('The rate is not recorded in this preview.'));
  assert.doesNotMatch(n.text(), /NaN/);
  await n.unmount();
});

test('canvas phone: every table stacks below sm, each cell carrying its column\'s label', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(h(Table, {
    cols: [{ key: 'a', label: 'Fund', cell: (r) => r.a }, { key: 'b', label: 'Called', align: 'right', mono: true, cell: (r) => r.b }],
    rows: [{ a: 'Fund I', b: '$1.00' }], rowKey: (r) => r.a, template: '1fr 1fr',
  }));
  assert.match(html, /class="[^"]*\bhidden sm:grid\b/, 'the header row is desktop only');
  assert.match(html, /<span class="[^"]*sm:hidden[^"]*">Called<\/span>/, 'a stacked cell names its column');
  assert.doesNotMatch(html, /<span class="[^"]*sm:hidden[^"]*">Fund<\/span>/, 'the first cell is the row\'s own name');
  assert.match(html, /grid-cols-1/, 'one column on a phone');
});
