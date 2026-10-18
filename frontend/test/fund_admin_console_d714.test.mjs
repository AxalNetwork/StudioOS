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
import { TABS, tabFrom, HQ_ONLY, PAYMENT_INSTRUCTIONS_ADMIN } from '../src/pages/admin/fundAdmin/fundAdminModel.js';
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
    overview: ['Axal Holdings', 'Operating · ending 9001', '$12,345.67', 'Example Fund I', '2 overdue', '2026Q3 · issued', '1 draft · 2 prepared', '3 proposed · 1 need review'],
    banking: ['Holdings Org', 'ending 9001', 'Current $12,345.67', 'Available Unreadable', 'Page 1 of 2', 'LP One'],
    reconciliation: ['$1,000.00 · Capital-call line #11', 'Fee period #41', 'needs_review'],
    calls: ['Example Fund I · capital calls', '$100,000.00 of $500,000.00 committed', 'Open the call ledger', 'Open the books'],
    distributions: ['Carry withheld', 'the job’s 20% default', '1 LP share rounded to zero', 'LP One · $4,500.00'],
    fees: ['2% a year from 2026-01-01', '1 LP has no admission date recorded', '2026Q3 · net $2,500.00', '2026Q4 · net $2,500.00'],
    reports: ['Q3 2026 · lp quarterly report', 'prepared', 'Opened, and recorded in the audit log'],
  };
  for (const [tab, words] of Object.entries(expect)) {
    const { m } = await open(SUPER, tab);
    const text = m.text();
    assert.ok(m.by(`fund-admin-panel-${tab}`), `${tab} panel`);
    for (const w of words) assert.ok(text.includes(w), `${tab}: missing "${w}" in: ${text.slice(0, 400)}`);
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
  assert.ok(rec.text().includes('No match in this state'));
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
