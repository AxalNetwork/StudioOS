/**
 * D802 (#2238) — "Annual fee invoices" on HQ's licence page: the list, Issue,
 * Record payment and the PDF, and the api module behind them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_fee_invoices_d802.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';

import { licenceFeeInvoicesApi } from '../src/lib/api.js';
import { FeeInvoicesList, STATUS_LABEL, money, parseMinor, writeError } from '../src/pages/admin/LicenceFeeInvoicesPanel.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const noop = async () => {};
const render = (data) => renderToStaticMarkup(createElement(FeeInvoicesList, { data, onIssue: noop, onRecord: noop, onVoid: noop, onPdf: noop }));

const INV = (o) => ({
  uid: 'inv_1', period_label: '2026–27', period_start: '2026-03-15', period_end: '2027-03-14', amount_cents: 1250000,
  currency: 'EUR', issued_at: '2026-10-20T10:00:00Z', due_at: '2026-11-19', status: 'issued', paid_cents: 0,
  void_reason: null, pdf_url: '/api/admin/licences/lic_a/fee-invoices/inv_1/pdf', ...o,
});

test('amounts are integer minor units both ways, and anything inexact is refused rather than rounded', () => {
  // Mutations checked: a parseFloat × 100 parse; a third decimal accepted.
  assert.equal(money(1250000, 'eur'), 'EUR 12,500.00');
  assert.equal(money(5, 'EUR'), 'EUR 0.05');
  assert.equal(parseMinor('12,500.00'), 1250000);
  assert.equal(parseMinor('12500'), 1250000);
  assert.equal(parseMinor('0.1'), 10);
  assert.equal(parseMinor('1.005'), null);
  assert.equal(parseMinor('-5'), null);
  assert.equal(parseMinor('12a'), null);
  assert.equal(parseMinor(''), null);
  assert.equal(parseMinor('19.99'), 1999, 'a float parse gives 1998.9999');
});

test('each invoice shows its period, date, amount, status and PDF; a part-payment says what was received', () => {
  const html = render({
    can_issue: false, next_period: { period_label: '2026–27' }, issue_refusal: 'The 2026–27 fee year is already invoiced.',
    invoices: [
      INV({ paid_cents: 500000 }),
      INV({ uid: 'inv_0', period_label: '2025–26', status: 'paid', paid_cents: 1250000 }),
      INV({ uid: 'inv_v', period_label: '2025–26', status: 'void', void_reason: 'Issued at the wrong amount', pdf_url: null }),
    ],
  });
  assert.ok(html.includes('Annual fee invoices'));
  assert.ok(html.includes('2026–27') && html.includes('2026-10-20') && html.includes('EUR 12,500.00'));
  assert.ok(html.includes('Issued · EUR 5,000.00 received'));
  assert.ok(html.includes('data-testid="fee-invoice-status-inv_0">Paid'));
  assert.ok(html.includes('Voided: Issued at the wrong amount'));
  assert.equal((html.match(/>PDF</g) || []).length, 2, 'a void invoice offered its PDF');
  assert.equal((html.match(/>Record payment</g) || []).length, 1, 'only an issued invoice takes a payment');
  const issueTag = (h) => h.match(/<button[^>]*data-testid="fee-invoice-issue"[^>]*>/)[0];
  assert.match(issueTag(html), /\sdisabled=""/, 'Issue was offered for a year already invoiced');
  assert.ok(html.includes('already invoiced'), 'the reason Issue is unavailable is not shown');
  assert.deepEqual(STATUS_LABEL, { issued: 'Issued', paid: 'Paid', void: 'Void' });
});

test('with no invoices it says so, and Issue names the fee year it would invoice', () => {
  const html = render({ can_issue: true, next_period: { period_label: '2026–27' }, issue_refusal: null, invoices: [] });
  assert.ok(html.includes('No fee invoice has been issued for this licence.'));
  assert.ok(html.includes('Issue 2026–27'));
  assert.doesNotMatch(html.match(/<button[^>]*data-testid="fee-invoice-issue"[^>]*>/)[0], /\sdisabled=""/);
});

test('a lapsed step-up reads as one, and any other refusal is the server\'s own sentence', () => {
  assert.match(writeError({ code: 'step_up_required' }, 'x'), /step-up has lapsed/);
  assert.equal(writeError({ message: 'The 2026–27 fee year is already invoiced.' }, 'x'), 'The 2026–27 fee year is already invoiced.');
  assert.equal(writeError({}, 'fallback'), 'fallback');
});

test('the api module calls the Worker\'s four routes, and the panel sits on HQ\'s licence page', () => {
  for (const k of ['list', 'issue', 'recordPayment', 'void', 'pdfBlob']) assert.equal(typeof licenceFeeInvoicesApi[k], 'function', k);
  const SRC = codeOnly(read('frontend/src/lib/api/licenceFeeInvoices.js'));
  assert.match(SRC, /\/admin\/licences\/\$\{enc\(uid\)\}\/fee-invoices`/);
  assert.match(SRC, /method: 'PATCH'/);
  const WORKER = read('cloudflare-worker/src/routes/admin_licence_fee_invoices.ts');
  for (const route of ["r.get('/:uid/fee-invoices'", "r.post('/:uid/fee-invoices'", "r.patch('/:uid/fee-invoices/:invoiceUid'", "r.get('/:uid/fee-invoices/:invoiceUid/pdf'"]) {
    assert.ok(WORKER.includes(route), route);
  }
  const PAGE = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
  assert.match(PAGE, /<LicenceFeeInvoicesPanel licence=\{d\} \/>/);
});
