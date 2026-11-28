/**
 * D9107 (#9107): the Fees tab records the inputs the management fee is
 * computed from — fee terms, an LP's admission date, net invested capital and
 * an offset — each in a dialog that sends the exact `fee.write` body, reloads
 * the read on success and shows the Worker's sentences on a refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { fixtures } from './fund_admin_d1165_fixtures.mjs';
import { bpsToPercentInput, percentToBps } from '../src/lib/bps.js';
import { netInvestedBody, offsetBody, refusalLines, termsBody } from '../src/pages/admin/fundAdmin/feeInputsModel.js';

const h = React.createElement;
const pause = () => new Promise(r => setTimeout(r, 0));
const SUPPORT = 'A support session cannot move fund money or write a fund’s books.';
const DEFAULTS = { annual_bps: 200, basis_during: 'committed', basis_after: 'net_invested', frequency: 'quarterly_in_advance', payee: 'gp', offset_bps: 10000 };
const OFFSETS = [
  { uid: 'off1', project_id: 12, axal_entity: 'management', amount_cents: 120000, received_on: '2026-08-14', description: 'Transaction fee', source: 'Invoice 14', counted_in: '2026Q3' },
  { uid: 'off2', project_id: 13, axal_entity: 'gp', amount_cents: 5000, received_on: '2026-10-02', description: 'Board fee', source: 'Board minutes', counted_in: null },
];
const POSITIONS = { fund_id: 7, as_of: '2026-10-26', unmarked: 1, items: [
  { id: 1, project_id: 12, company_name: 'Example Co' },
  { id: 2, project_id: 12, company_name: 'Example Co' },
  { id: 3, project_id: null, company_name: 'Unattributed' },
  { id: 4, project_id: 13, company_name: 'Sample Labs' },
] };
const baseState = (over = {}) => ({
  defaults: DEFAULTS,
  terms: [{ uid: 'terms1', status: 'draft', annual_bps: 200, effective_from: '2026-01-01' }],
  lps: [{ id: 4, admitted_on: null, admission_missing: true, commitment_amount: 10000 }],
  net_invested: [], offsets: OFFSETS, periods: [{ quarter: '2026Q3', status: 'draft', net_cents: 12345 }], ...over,
});
const refusal = (message, extra = {}) => Object.assign(new Error(message), extra);

async function mount(over = {}) {
  const s = fixtures({ feeState: over.feeState || (() => baseState()), ...(over.access ? { access: over.access } : {}) });
  const rec = (name, fn) => (...args) => { s.calls.push([name, ...args]); return Promise.resolve().then(() => fn(...args)); };
  s.apis.fees.recordTerms = rec('recordTerms', over.recordTerms || (() => ({ uid: 'new', status: 'draft' })));
  s.apis.fees.recordAdmission = rec('recordAdmission', over.recordAdmission || ((f, lp, b) => ({ limited_partner_id: lp, admitted_on: b.admitted_on })));
  s.apis.fees.recordNetInvested = rec('recordNetInvested', over.recordNetInvested || (() => ({ uid: 'net' })));
  s.apis.fees.recordOffset = rec('recordOffset', over.recordOffset || (() => ({ uid: 'off' })));
  s.apis.performance = { list: rec('performanceList', () => ({ items: [] })), positions: rec('positions', over.positions || (() => POSITIONS)) };
  const restore = installDocument();
  document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const el = document.createElement('div'); document.body.appendChild(el); const root = createRoot(el);
  const props = n => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = n => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '';
  const by = id => walk(el).find(n => props(n)['data-testid'] === id);
  const flush = async fn => act(async () => { await fn?.(); for (let i = 0; i < 8; i++) await pause(); });
  await flush(() => root.render(h(MemoryRouter, { initialEntries: ['/admin/fund-admin/fees'] }, h(FundAdminConsoleView, { user: { role: 'admin' }, apis: s.apis }))));
  const named = name => s.calls.filter(([n]) => n === name);
  return { ...s, by, props, named, text: id => text(id ? by(id) : el).replace(/\s+/g, ' ').trim(),
    click: id => flush(() => props(by(id)).onClick?.({ button: 0, preventDefault() {}, defaultPrevented: false })),
    type: (id, value) => flush(() => props(by(id)).onChange({ target: { value } })),
    submit: id => flush(() => props(by(id)).onSubmit({ preventDefault() {} })),
    close: async () => { await act(async () => root.unmount()); restore(); },
  };
}

test('D9107: a percent is basis points by its digits, never a float', () => {
  assert.equal(percentToBps('1.50'), 150);
  assert.equal(percentToBps('2'), 200);
  assert.equal(percentToBps('1.15'), 115); // 1.15 * 100 is 114.99999999999999
  assert.equal(percentToBps('2.5%'), 250);
  assert.equal(percentToBps(' 0 '), 0);
  for (const bad of ['2.005', '-1', '+1', '1.', '.5', 'abc', '1,5', '', '   ', null, undefined, {}]) {
    assert.equal(percentToBps(bad), null, `${JSON.stringify(bad)} is refused`);
  }
  assert.equal(bpsToPercentInput(200), '2.00');
  assert.equal(bpsToPercentInput(150), '1.50');
  assert.equal(bpsToPercentInput(5), '0.05');
  assert.equal(bpsToPercentInput(null), null);
  assert.equal(percentToBps(bpsToPercentInput(10000)), 10000);
});

test('D9107: dollars are whole cents, and the bodies are exactly what the routes take', () => {
  assert.deepEqual(netInvestedBody({ asOf: '2026-09-30', amount: '1,200.50', source: ' Schedule ' }).body, { as_of: '2026-09-30', net_invested_cents: 120050, source: 'Schedule' });
  assert.equal(netInvestedBody({ amount: '0' }).body.net_invested_cents, 0);
  assert.ok(netInvestedBody({ amount: '' }).error);
  assert.ok(netInvestedBody({ amount: '12.345' }).error);
  assert.equal(offsetBody({ project: '12', amount: '1,200.50' }).body.amount_cents, 120050);
  assert.ok(offsetBody({ project: '', amount: '5' }).error, 'a company is chosen first');
  assert.ok(termsBody({ rate: '2.005', offset: '100' }).error);
  assert.ok(termsBody({ rate: '100.01', offset: '100' }).error, 'a rate is at most 100%');
  assert.ok(termsBody({ rate: '2', offset: '' }).error);
  assert.equal('effective_from' in termsBody({ rate: '2', offset: '100' }).body, false);
  assert.equal(termsBody({ rate: '2', offset: '100', effective: '2027-01-01' }, { hasConfirmed: true }).body.effective_from, '2027-01-01');
  assert.deepEqual(refusalLines(refusal('One.', { data: { refusals: ['One.', 'Two.', 'One.'] } }), 'x'), ['One.', 'Two.']);
  assert.deepEqual(refusalLines(refusal('Only.'), 'x'), ['Only.']);
  assert.deepEqual(refusalLines({}, 'Fallback.'), ['Fallback.']);
});

test('D9107: an Admin records a first terms version from the defaults; it reloads and the Admin reads the Super Admin sentence', async () => {
  let recorded = false;
  const m = await mount({
    feeState: () => baseState(recorded ? { terms: [{ uid: 'terms1', status: 'draft', annual_bps: 150, effective_from: '2026-01-01', fee_start_date: '2026-01-01', investment_period_end: '2030-12-31', lpa_reference: 'LPA 8.1' }] } : { terms: [] }),
    recordTerms: () => { recorded = true; return { uid: 'terms1', status: 'draft' }; },
  });
  try {
    assert.match(m.text('fee-terms'), /No terms recorded/);
    await m.click('fee-terms-record');
    assert.equal(m.props(m.by('fee-terms-dialog-layer'))['data-phone'], 'sheet');
    assert.equal(m.props(m.by('fee-terms-rate')).value, '2.00');
    assert.equal(m.props(m.by('fee-terms-offset')).value, '100.00');
    assert.equal(m.props(m.by('fee-terms-basis')).value, 'net_invested');
    assert.ok(!m.by('fee-terms-effective'), 'a first version takes effect on its fee start date');
    assert.match(m.text('fee-terms-first'), /takes effect on the fee start date/);
    await m.type('fee-terms-rate', '1.50');
    await m.type('fee-terms-start', '2026-01-01');
    await m.type('fee-terms-period-end', '2030-12-31');
    await m.type('fee-terms-lpa', ' LPA 8.1 ');
    await m.submit('fee-terms-dialog-form');
    assert.deepEqual(m.named('recordTerms'), [['recordTerms', 7, { annual_bps: 150, offset_bps: 10000, basis_after: 'net_invested', fee_start_date: '2026-01-01', investment_period_end: '2030-12-31', lpa_reference: 'LPA 8.1' }]]);
    assert.ok(!m.by('fee-terms-dialog'), 'the dialog closes');
    assert.equal(m.named('feeState').length, 2, 'the read is reloaded');
    assert.match(m.text('fee-terms-terms1'), /^1\.5% a year from 2026-01-01 Fee start 2026-01-01 · investment period to 2030-12-31 LPA LPA 8\.1 Status draft/);
    assert.match(m.text('fee-terms-refused-terms1'), /A Super Admin confirms a fund’s fee terms\./);
  } finally { await m.close(); }
});

test('D9107: with a confirmed version, a lower draft is a step-down; the refusal lines stay in the open dialog', async () => {
  const confirmed = { uid: 'terms0', status: 'confirmed', annual_bps: 200, effective_from: '2026-01-01', fee_start_date: '2026-01-01', investment_period_end: '2030-12-31', lpa_reference: 'LPA 8' };
  const sentences = ['A later version takes effect on the first day of a quarter after every issued period.', 'A confirmed version already takes effect on that date.'];
  const m = await mount({
    feeState: () => baseState({ terms: [confirmed, { uid: 'terms2', status: 'draft', annual_bps: 150, effective_from: '2027-01-01', fee_start_date: '2026-01-01' }] }),
    recordTerms: () => { throw refusal(sentences[0], { status: 400, data: { error: 'fee_refused', refusals: sentences } }); },
    access: () => ({ super_admin: true, acts: [] }),
  });
  try {
    assert.match(m.text('fee-terms-terms2'), /Step-down to 1\.5% from 2027-01-01/);
    assert.match(m.text('fee-terms-terms0'), /2% a year from 2026-01-01/);
    assert.ok(m.by('fee-terms-confirm-terms2'), 'the Super Admin keeps Confirm');
    await m.click('fee-terms-record');
    assert.equal(m.props(m.by('fee-terms-start')).value, '2026-01-01');
    assert.equal(m.props(m.by('fee-terms-start')).readOnly, true);
    assert.equal(m.props(m.by('fee-terms-period-end')).value, '2030-12-31');
    assert.match(m.text('fee-terms-dialog'), /Takes effect The first day of a quarter after every issued period\./);
    await m.type('fee-terms-rate', '1.25');
    await m.type('fee-terms-effective', '2026-02-01');
    await m.type('fee-terms-lpa', 'LPA 8.2');
    await m.submit('fee-terms-dialog-form');
    assert.deepEqual(m.named('recordTerms')[0][2], { annual_bps: 125, offset_bps: 10000, basis_after: 'net_invested', fee_start_date: '2026-01-01', investment_period_end: '2030-12-31', lpa_reference: 'LPA 8.2', effective_from: '2026-02-01' });
    assert.equal(m.text('fee-terms-dialog-error'), sentences.join(' '));
    assert.equal(m.props(m.by('fee-terms-rate')).value, '1.25', 'the entered values stay');
    assert.equal(m.named('feeState').length, 1, 'a refusal reloads nothing');
  } finally { await m.close(); }
});

test('D9107: an admission date is recorded for LP #4 and the missing count goes down; a 409 shows its sentence', async () => {
  let admitted = false;
  const m = await mount({
    feeState: () => baseState({ lps: [
      { id: 4, admitted_on: admitted ? '2026-02-01' : null, closing_label: admitted ? 'Second close' : null, source: admitted ? 'Side letter' : null, admission_missing: !admitted, commitment_amount: 10000 },
      { id: 5, admitted_on: null, admission_missing: true, commitment_amount: 5000 },
    ] }),
    recordAdmission: (f, lp, b) => { admitted = true; return { limited_partner_id: lp, admitted_on: b.admitted_on }; },
  });
  try {
    assert.match(m.text('fee-terms'), /2 LPs have no admission date recorded\./);
    assert.match(m.text('fee-admission-record-4'), /^Record date$/);
    await m.click('fee-admission-record-4');
    assert.match(m.text('fee-admission-dialog'), /LP #4/);
    await m.type('fee-admission-date', '2026-02-01');
    await m.type('fee-admission-label', 'Second close');
    await m.type('fee-admission-source', 'Side letter');
    await m.submit('fee-admission-dialog-form');
    assert.deepEqual(m.named('recordAdmission'), [['recordAdmission', 7, 4, { admitted_on: '2026-02-01', closing_label: 'Second close', source: 'Side letter' }]]);
    assert.ok(!m.by('fee-admission-dialog'));
    assert.equal(m.named('feeState').length, 2);
    assert.match(m.text('fee-terms'), /1 LP has no admission date recorded\./);
    assert.match(m.text('fee-admission-4'), /Admitted 2026-02-01 .*Source Second close · Side letter Action Change date/);
  } finally { await m.close(); }

  const fixed = 'This LP has an issued fee line, so its admission date is fixed.';
  const n = await mount({ recordAdmission: () => { throw refusal(fixed, { status: 409, data: { error: 'fee_refused', refusals: [fixed] } }); } });
  try {
    await n.click('fee-admission-record-4');
    await n.type('fee-admission-date', '2026-03-01');
    await n.type('fee-admission-source', 'Closing memo');
    await n.submit('fee-admission-dialog-form');
    assert.deepEqual(n.named('recordAdmission')[0][3], { admitted_on: '2026-03-01', closing_label: null, source: 'Closing memo' });
    assert.equal(n.text('fee-admission-dialog-error'), fixed);
    assert.equal(n.props(n.by('fee-admission-date')).value, '2026-03-01');
  } finally { await n.close(); }
});

test('D9107: net invested is recorded in whole cents, the list keeps earlier records, and the preview is cleared', async () => {
  const earlier = { uid: 'n1', as_of: '2026-06-30', net_invested_cents: 100000, source: 'Q2 schedule' };
  let rows = [earlier];
  const m = await mount({
    feeState: () => baseState({ net_invested: rows }),
    recordNetInvested: (f, b) => { rows = [{ uid: 'n2', as_of: b.as_of, net_invested_cents: b.net_invested_cents, source: b.source }, earlier]; return { uid: 'n2' }; },
  });
  try {
    assert.match(m.text('fee-net-invested'), /Net invested: \$1,000\.00 · as of 2026-06-30/);
    await m.type('fee-quarter', '2026Q4');
    let form = m.by('fee-preview-submit').parentNode;
    while (form && !m.props(form).onSubmit) form = form.parentNode;
    await act(async () => { m.props(form).onSubmit({ preventDefault() {} }); for (let i = 0; i < 8; i++) await pause(); });
    assert.ok(m.by('fee-preview'));
    const reads = m.named('feeState').length;
    await m.click('fee-net-record');
    await m.type('fee-net-as-of', '2026-09-30');
    await m.type('fee-net-amount', '1,200.50');
    await m.type('fee-net-source', 'Q3 schedule');
    await m.submit('fee-net-dialog-form');
    assert.deepEqual(m.named('recordNetInvested'), [['recordNetInvested', 7, { as_of: '2026-09-30', net_invested_cents: 120050, source: 'Q3 schedule' }]]);
    assert.ok(!m.by('fee-net-dialog'));
    assert.equal(m.named('feeState').length, reads + 1, 'the read is reloaded');
    assert.ok(!m.by('fee-preview'), 'a record changes the digest, so the preview goes');
    assert.match(m.text('fee-net-invested'), /Net invested: \$1,200\.50 · as of 2026-09-30/);
    assert.match(m.text('fee-net-n2'), /^2026-09-30 Net invested \$1,200\.50 Source Q3 schedule$/);
    assert.match(m.text('fee-net-n1'), /^2026-06-30 Net invested \$1,000\.00 Source Q2 schedule$/);
  } finally { await m.close(); }
});

test('D9107: a support session meets the Worker’s 403 sentence inside the dialog', async () => {
  const m = await mount({ recordNetInvested: () => { throw refusal(SUPPORT, { status: 403, data: { error: 'support_session', message: SUPPORT } }); } });
  try {
    await m.click('fee-net-record');
    await m.type('fee-net-as-of', '2026-09-30');
    await m.type('fee-net-amount', '50');
    await m.type('fee-net-source', 'Schedule');
    await m.submit('fee-net-dialog-form');
    assert.equal(m.named('recordNetInvested')[0][2].net_invested_cents, 5000);
    assert.equal(m.text('fee-net-dialog-error'), SUPPORT);
    assert.ok(m.by('fee-net-dialog'), 'the dialog stays open');
    assert.doesNotMatch(m.text('fee-net-invested'), /\$50\.00/, 'nothing claims it was saved');
  } finally { await m.close(); }
});

test('D9107: offsets list counted_in, and one is recorded against a company of this fund', async () => {
  const m = await mount();
  try {
    assert.match(m.text('fee-offset-off1'), /^Company #12 Axal entity Management Amount \$1,200\.00 Received 2026-08-14 Description Transaction fee Invoice 14 Counted Counted in 2026Q3$/);
    assert.match(m.text('fee-offset-off2'), /^Company #13 Axal entity GP Amount \$50\.00 Received 2026-10-02 Description Board fee Board minutes Counted Not counted yet$/);
    assert.ok(!m.named('positions').length, 'the positions are read only when the dialog opens');
    await m.click('fee-offset-record');
    assert.deepEqual(m.named('positions'), [['positions', 7]]);
    const options = m.by('fee-offset-company').childNodes.map(o => m.props(o).value);
    assert.deepEqual(options, ['', '12', '13'], 'one per company, none without a project');
    assert.equal(m.props(m.by('fee-offset-dialog-submit')).disabled, false);
    await m.type('fee-offset-company', '13');
    await m.type('fee-offset-entity', 'gp');
    await m.type('fee-offset-amount', '1,200.50');
    await m.type('fee-offset-received', '2026-10-20');
    await m.type('fee-offset-description', 'Monitoring fee');
    await m.type('fee-offset-source', 'Invoice 21');
    await m.submit('fee-offset-dialog-form');
    assert.deepEqual(m.named('recordOffset'), [['recordOffset', 7, { project_id: 13, axal_entity: 'gp', amount_cents: 120050, received_on: '2026-10-20', description: 'Monitoring fee', source: 'Invoice 21' }]]);
    assert.ok(!m.by('fee-offset-dialog'));
    assert.equal(m.named('feeState').length, 2);
  } finally { await m.close(); }
});

test('D9107: the company picker says when positions are unreadable or empty, and Record stays disabled', async () => {
  let m = await mount({ positions: () => { throw new Error('unavailable'); } });
  try {
    await m.click('fee-offset-record');
    assert.match(m.text('fee-offset-companies-unreadable'), /could not be read\. This is not a claim that there are none\./);
    assert.equal(m.props(m.by('fee-offset-dialog-submit')).disabled, true);
    await m.submit('fee-offset-dialog-form');
    assert.equal(m.named('recordOffset').length, 0);
  } finally { await m.close(); }
  m = await mount({ positions: () => ({ items: [{ id: 3, project_id: null, company_name: 'Unattributed' }] }), feeState: () => baseState({ offsets: [] }) });
  try {
    assert.match(m.text('fee-offsets'), /No offset recorded/);
    await m.click('fee-offset-record');
    assert.equal(m.text('fee-offset-companies-empty'), 'No position is attributed to this fund yet.');
    assert.equal(m.props(m.by('fee-offset-dialog-submit')).disabled, true);
  } finally { await m.close(); }
});
