/**
 * D802 (#2238) — HQ's "Annual fee invoices" tab on a licence: the words and
 * the amount rule (`licenceFeeInvoicesModel.js`), the list's states, Issue,
 * Record payment and Void against a stubbed API, and the routes the API module
 * calls. The Worker's half is cloudflare-worker/test/licence_fee_invoices_d802.test.ts.
 * Each case names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_fee_invoices_d802.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import LicenceFeeInvoices from '../src/pages/admin/LicenceFeeInvoices.jsx';
import { feeLine, money, paidLine, parseAmount } from '../src/pages/admin/licenceFeeInvoicesModel.js';

const h = React.createElement;
const LICENCE = { uid: 'lic_a' };
const INV = {
  uid: 'inv_1', period_label: '2026–27', period_start: '2026-03-15', period_end: '2027-03-14', amount_cents: 1200000, currency: 'EUR',
  paid_cents: 0, outstanding_cents: 1200000, reference: 'AXAL-LIC-LIC-A-2026-27', issued_at: '2026-10-20', due_at: '2026-11-19',
  status: 'issued', paid_at: null, paid_note: null, void_note: null, pdf_url: '/api/admin/licences/lic_a/fee-invoices/inv_1/pdf',
};
const READ = { invoices: [INV], annual_fee_cents: 1200000, currency: 'EUR', starts_on: '2020-03-15' };

// 1 ───────────────────────────────────────────────────────────────────────────
test('the words: money in the invoice\'s currency, the typed total, the fee line and what was received', () => {
  // Mutations checked: the euro sign dropped; three decimals accepted; a negative accepted; the no-fee line not drawn; a void read as unpaid.
  assert.equal(money(1200000, 'EUR'), '€12,000.00');
  assert.equal(money(5, 'usd'), '$0.05');
  assert.equal(money(123456, 'CHF'), 'CHF 1,234.56');
  assert.equal(money(null, 'EUR'), 'Not recorded');
  assert.equal(parseAmount('4,000.5'), 400050);
  assert.equal(parseAmount('€12000'), 1200000);
  assert.equal(parseAmount('0'), 0);
  for (const bad of ['1.234', '-1', 'abc', '']) assert.equal(parseAmount(bad), null, bad);
  assert.deepEqual(feeLine(READ), { ok: true, text: 'Annual fee €12,000.00. Each licence year starts on the anniversary of 2020-03-15.' });
  assert.equal(feeLine({ ...READ, annual_fee_cents: null }).ok, false);
  assert.match(feeLine({ ...READ, starts_on: null }).text, /No start date/);
  assert.equal(paidLine(INV), 'Nothing yet');
  assert.equal(paidLine({ ...INV, paid_cents: 400000 }), '€4,000.00 of €12,000.00');
  assert.equal(paidLine({ ...INV, status: 'void' }), 'Void');
});

async function mount(api) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await act(async () => { root.render(h(LicenceFeeInvoices, { licence: LICENCE, api })); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    by, props, text: () => text(container),
    click: (id) => act(async () => { props(by(id)).onClick(); await settle(); await settle(); }),
    type: (id, value) => act(async () => { props(by(id)).onChange({ target: { value } }); }),
    submit: (id) => act(async () => { props(by(id)).onSubmit({ preventDefault() {} }); await settle(); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// 2 ───────────────────────────────────────────────────────────────────────────
test('the list draws each invoice, its states, and Issue calls the Worker and reads again', async () => {
  // Mutations checked: Issue not calling the API; the list not re-read after issuing; Issue enabled with no fee; the unreadable state dropped.
  const calls = [];
  let read = { ...READ, invoices: [] };
  const api = { list: async () => { calls.push('list'); return read; }, issue: async (uid) => { calls.push(`issue:${uid}`); read = READ; return {}; } };
  const m = await mount(api);
  try {
    assert.ok(m.by('fee-invoices-empty'));
    await m.click('fee-invoices-issue');
    assert.deepEqual(calls, ['list', 'issue:lic_a', 'list']);
    assert.ok(m.by('fee-invoice-inv_1'));
    assert.match(m.text(), /2026–27/);
    assert.match(m.text(), /AXAL-LIC-LIC-A-2026-27/);
    assert.match(m.text(), /€12,000\.00/);
    assert.match(m.text(), /Invoice issued\./);
  } finally { await m.unmount(); }

  const noFee = await mount({ list: async () => ({ ...READ, annual_fee_cents: null, invoices: [] }) });
  try { assert.equal(noFee.props(noFee.by('fee-invoices-issue')).disabled, true); } finally { await noFee.unmount(); }
  const down = await mount({ list: async () => { throw new Error('boom'); } });
  try { assert.ok(down.by('fee-invoices-unreadable')); } finally { await down.unmount(); }
  const refused = await mount({ list: async () => READ, issue: async () => { throw new Error('The 2026–27 licence year is already invoiced.'); } });
  try {
    await refused.click('fee-invoices-issue');
    assert.match(refused.text(refused.by('fee-invoices-outcome-error')), /already invoiced/);
  } finally { await refused.unmount(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('Record payment sends the total in cents with its note; Void needs a reason and is offered only with nothing paid', async () => {
  // Mutations checked: the total sent as typed text; a bad total sent; a void sent without its reason; Void offered on a paid invoice.
  const sent = [];
  const api = {
    list: async () => READ,
    recordPayment: async (...a) => { sent.push(['pay', ...a]); return {}; },
    voidInvoice: async (...a) => { sent.push(['void', ...a]); return {}; },
  };
  const m = await mount(api);
  try {
    await m.click('fee-invoice-record');
    await m.type('fee-invoice-paid', '4,000.1x');
    assert.ok(m.by('fee-invoice-paid-error'));
    await m.submit('fee-invoice-pay-form');
    assert.deepEqual(sent, [], 'nothing sent with a bad total');
    await m.type('fee-invoice-paid', '4,000.10');
    await m.type('fee-invoice-note', ' Bank ref 1 ');
    await m.submit('fee-invoice-pay-form');
    assert.deepEqual(sent, [['pay', 'lic_a', 'inv_1', 400010, 'Bank ref 1']]);
    await m.click('fee-invoice-void');
    await m.type('fee-invoice-void-note', 'short');
    await m.submit('fee-invoice-void-form');
    assert.equal(sent.length, 1, 'no void without a reason');
    await m.type('fee-invoice-void-note', 'Issued to the wrong licence year');
    await m.submit('fee-invoice-void-form');
    assert.deepEqual(sent[1], ['void', 'lic_a', 'inv_1', 'Issued to the wrong licence year']);
  } finally { await m.unmount(); }
  const paid = await mount({ list: async () => ({ ...READ, invoices: [{ ...INV, paid_cents: 100, status: 'issued' }] }) });
  try { assert.equal(paid.by('fee-invoice-void'), undefined, 'a payment is recorded: no Void'); } finally { await paid.unmount(); }
  const voided = await mount({ list: async () => ({ ...READ, invoices: [{ ...INV, status: 'void', pdf_url: null }] }) });
  try {
    assert.equal(voided.by('fee-invoice-record'), undefined);
    assert.equal(voided.by('fee-invoice-pdf'), undefined, 'a void invoice has no PDF');
  } finally { await voided.unmount(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the calls go to the Worker\'s routes, and the licence console draws the tab', () => {
  // Mutations checked: a call pointed elsewhere; the tab not mounted.
  const src = readFileSync(new URL('../src/lib/api/licenceFeeInvoices.js', import.meta.url), 'utf8');
  assert.match(src, /list: \(licenceUid\) => request\(`\/admin\/licences\/\$\{enc\(licenceUid\)\}\/fee-invoices`\)/);
  assert.match(src, /issue: \(licenceUid\) => request\(`\/admin\/licences\/\$\{enc\(licenceUid\)\}\/fee-invoices`, \{ method: 'POST' \}\)/);
  assert.match(src, /method: 'PATCH', body: JSON\.stringify\(\{ paid_cents: paidCents/);
  assert.match(src, /method: 'PATCH', body: JSON\.stringify\(\{ status: 'void', void_note: voidNote \}\)/);
  assert.match(src, /`\/licence\/mine\/fee-invoices\/\$\{enc\(invoiceUid\)\}\/pdf`/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/admin_licences.ts', import.meta.url), 'utf8');
  for (const route of ["r.get('/:uid/fee-invoices'", "r.post('/:uid/fee-invoices'", "r.patch('/:uid/fee-invoices/:invoiceUid'", "r.get('/:uid/fee-invoices/:invoiceUid/pdf'"]) {
    assert.ok(worker.includes(route), route);
  }
  assert.ok(readFileSync(new URL('../../cloudflare-worker/src/routes/licence.ts', import.meta.url), 'utf8').includes("r.get('/mine/fee-invoices/:uid/pdf'"));
  assert.match(readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8'), /export \* from '\.\/api\/licenceFeeInvoices\.js';/);
  const page = readFileSync(new URL('../src/pages/admin/AdminLicences.jsx', import.meta.url), 'utf8');
  assert.match(page, /\{step === FEE_INVOICES_STEP && <LicenceFeeInvoices licence=\{d\} \/>\}/);
  assert.match(page, /data-testid="licence-fee-invoices-tab"/);
});
