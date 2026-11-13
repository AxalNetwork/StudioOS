/**
 * D5036 part 2 (#5036) — "Overdue invoices are identifiable" on screen.
 *
 * The Worker lists overdue licence-fee invoices one by one (D5036). The cockpit counts them (D5082). The licence's
 * Annual fee invoices tab now marks each one Overdue, with how many days past due, on the Worker's own rule:
 *   - not void;
 *   - a balance left;
 *   - the due date before today, a UTC day.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_fee_invoices_overdue_5036.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import LicenceFeeInvoices from '../src/pages/admin/LicenceFeeInvoices.jsx';
import { invoiceStatus } from '../src/pages/admin/licenceFeeInvoicesModel.js';

const h = React.createElement;
const TODAY = '2026-11-13';
const INV = {
  uid: 'inv_1', period_label: '2026–27', period_start: '2026-03-15', period_end: '2027-03-14', amount_cents: 1_200_000, currency: 'EUR',
  paid_cents: 400_000, outstanding_cents: 800_000, reference: 'AXAL-LIC-LIC-A-2026-27', issued_at: '2026-03-15', due_at: '2026-04-14',
  status: 'issued', paid_at: null, paid_note: null, void_note: null, pdf_url: null, revision: 0,
};

test('the rule: a balance left past its due date is Overdue; paid, void or not yet due is not', () => {
  // Mutations checked: the due date ignored; a void invoice called overdue; a paid one called overdue; the day count off.
  assert.deepEqual(invoiceStatus(INV, TODAY), { word: 'Overdue', tone: 'danger', overdue: true, days: 213 });
  assert.equal(invoiceStatus({ ...INV, due_at: '2026-11-13' }, TODAY).overdue, false, 'due today is not yet overdue');
  assert.equal(invoiceStatus({ ...INV, due_at: '2026-12-01' }, TODAY).word, 'Issued');
  assert.equal(invoiceStatus({ ...INV, status: 'void', paid_cents: 0 }, TODAY).word, 'Void', 'a void invoice is never overdue');
  assert.equal(invoiceStatus({ ...INV, status: 'paid', paid_cents: 1_200_000 }, TODAY).word, 'Paid');
  assert.equal(invoiceStatus({ ...INV, due_at: null }, TODAY).word, 'Issued', 'no due date, no claim that it is overdue');
});

test('the tab marks each overdue invoice, and only those', async () => {
  // Mutations checked: the status pill left at the invoice's own status; the days-past-due line dropped.
  const later = { ...INV, uid: 'inv_2', reference: 'AXAL-LIC-LIC-A-2027-28', period_label: '2027–28', due_at: '2027-04-14', paid_cents: 0 };
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const api = { list: async () => ({ invoices: [INV, later], annual_fee_cents: 1_200_000, currency: 'EUR', starts_on: '2020-03-15' }) };
  try {
    await act(async () => { root.render(h(LicenceFeeInvoices, { licence: { uid: 'lic_a' }, api, today: TODAY })); await settle(); await settle(); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
    const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
    assert.match(text(by('fee-invoice-inv_1')), /Overdue213 days past due/);
    assert.match(text(by('fee-invoice-inv_2')), /Issued/);
    assert.doesNotMatch(text(by('fee-invoice-inv_2')), /Overdue|past due/);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
