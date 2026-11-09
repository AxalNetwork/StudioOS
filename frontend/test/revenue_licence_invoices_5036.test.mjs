/**
 * D5036 — HQ · Revenue keeps run-rate, invoiced, collected and outstanding apart.
 *
 * The "By stream" row used to sit under "This quarter" with a quarter of each annual fee in it, which read as quarterly
 * revenue. The figure stays and is named a contracted run-rate; the invoice ledger's figures get their own zone.
 *
 * Mutations checked: the run-rate label dropped from the stream row; collected drawn in the outstanding column; a void
 * invoice drawn as invoiced; the overdue list dropped; the gap list dropped; an unreadable ledger drawn as "none
 * invoiced"; a future quarter offered by the picker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LicenceInvoices, recentQuarters, CANNOT_INVOICE } from '../src/pages/hq/RevenuePage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const root = new URL('../../', import.meta.url);
const PAGE = codeOnly(readFileSync(new URL('frontend/src/pages/hq/RevenuePage.jsx', root), 'utf8'));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
const draw = (invoices) => renderToStaticMarkup(React.createElement(LicenceInvoices, { invoices, onRetry: () => {} }));

/** The Worker's `licence_invoices` payload (services/licenceFeeReceivables.ts). */
const LEDGER = {
  available: true,
  period: { start: '2026-07-01', end: '2026-10-01', label: 'Q3 2026' },
  basis: { invoiced: 'BASIS-INVOICED', collected: 'BASIS-COLLECTED', outstanding: 'x', receivable: 'BASIS-RECEIVABLE', void: 'BASIS-VOID' },
  by_currency: [
    { currency: 'EUR', invoices: 2, invoiced_cents: 600_000, collected_cents: 350_000, outstanding_cents: 250_000, overdue_invoices: 0, overdue_cents: 0, void_invoices: 1, void_cents: 400_000 },
    { currency: 'GBP', invoices: 1, invoiced_cents: 900_000, collected_cents: 0, outstanding_cents: 900_000, overdue_invoices: 1, overdue_cents: 900_000, void_invoices: 0, void_cents: 0 },
  ],
  receivable_by_currency: [
    { currency: 'EUR', open_invoices: 2, outstanding_cents: 550_000, overdue_invoices: 1, overdue_cents: 300_000 },
  ],
  overdue: [{ uid: 'i1', licence_uid: 'u1', licence_ref: 'FR-001', brand_name: 'Paris', reference: 'FR-001-2026', period_label: '2026–27', due_at: '2026-02-09', days_overdue: 218, outstanding_cents: 300_000, currency: 'EUR' }],
  overdue_total: 1,
  expected_not_invoiced: [
    { licence_uid: 'u2', licence_ref: 'DE-001', brand_name: 'Berlin', status: 'active', period_label: '2026–27', period_start: '2026-03-01', amount_cents: 400_000, currency: 'EUR', gap: 'not_invoiced' },
    { licence_uid: 'u3', licence_ref: 'IT-001', brand_name: 'Roma', status: 'suspended', period_label: '2026–27', period_start: '2026-03-01', amount_cents: 400_000, currency: 'EUR', gap: 'void_not_reissued' },
  ],
  cannot_invoice: [{ licence_uid: 'u4', licence_ref: 'ES-001', brand_name: 'Madrid', status: 'active', reason: 'no_start_date' }],
  not_started: 0,
};

test('invoiced, collected and outstanding are their own columns, per currency', () => {
  const h = draw(LEDGER);
  const rows = h.slice(h.indexOf('data-testid="hq-revenue-invoices-period"')).split('</tr>');
  const eur = text(rows[0]);
  assert.match(eur, /EUR €6,000\.00 2 invoices €3,500\.00 €2,500\.00 None 1 · €4,000\.00, in no other figure/, eur);
  assert.match(text(rows[1]), /GBP £9,000\.00 1 invoice £0\.00 £9,000\.00 £9,000\.00 · 1/);
  assert.doesNotMatch(text(h), /€15,000|total/i, 'a figure was added across currencies');
});

test('overdue invoices are listed, and the receivable carries the overdue part', () => {
  const t = text(draw(LEDGER));
  assert.match(t, /Overdue · 1/);
  assert.match(t, /Paris FR-001-2026 · 2026–27 2026-02-09 · 218 days late €3,000\.00/);
  assert.match(t, /Receivable today · EUR €5,500\.00 2 open · €3,000\.00 overdue on 1/);
});

test('a billable year nobody invoiced is a gap, with its reason', () => {
  const t = text(draw(LEDGER));
  assert.match(t, /Expected, not invoiced/);
  assert.match(t, /Berlin · 2026–27 · €4,000\.00 — the licence year has started and no invoice is issued/);
  assert.match(t, /Roma · 2026–27 · €4,000\.00 — its only invoice for this year is void.*\(suspended, still billable\)/);
  assert.match(t, new RegExp(`Madrid — cannot be invoiced: it ${CANNOT_INVOICE.no_start_date}`));
  assert.doesNotMatch(text(draw({ ...LEDGER, expected_not_invoiced: [], cannot_invoice: [] })), /Expected, not invoiced/);
});

test('the basis of each figure is said on the page', () => {
  const t = text(draw(LEDGER));
  for (const b of ['BASIS-INVOICED', 'BASIS-COLLECTED', 'BASIS-RECEIVABLE', 'BASIS-VOID']) assert.match(t, new RegExp(b));
  assert.match(t, /nothing is added across currencies/);
});

test('an empty period, an unreadable ledger and a load are three different things', () => {
  const none = text(draw({ ...LEDGER, by_currency: [], receivable_by_currency: [], overdue: [], overdue_total: 0, expected_not_invoiced: [], cannot_invoice: [] }));
  assert.match(none, /No licence-fee invoice was issued in Q3 2026/);
  assert.match(none, /Receivable today None/);
  const bad = draw({ available: false, reason: 'The licence-fee invoice ledger could not be read.' });
  assert.match(bad, /data-testid="hq-revenue-invoices-unreadable"/);
  assert.doesNotMatch(text(bad), /No licence-fee invoice was issued|None/, 'an unreadable ledger was drawn as an empty one');
  assert.match(text(draw(null)), /Loading the invoice ledger/);
});

test('the run-rate is labelled as one beside its figure, and the column is not "This quarter"', () => {
  assert.match(PAGE, /data-testid="hq-revenue-run-rate-label">\{fees\.label \|\| 'Contracted quarterly run-rate'\}, not invoiced or collected/);
  assert.doesNotMatch(PAGE, />This quarter</, 'the run-rate sits under "This quarter" again');
  assert.match(PAGE, /<LicenceInvoices invoices=\{ready \? data\.licence_invoices : null\}/);
});

test('the period picker offers the current quarter and those before it, never a future one', () => {
  assert.deepEqual(recentQuarters(new Date('2026-02-10T00:00:00Z'), 4), ['2026-Q1', '2025-Q4', '2025-Q3', '2025-Q2']);
  assert.deepEqual(recentQuarters(new Date('2026-12-31T23:00:00Z'), 2), ['2026-Q4', '2026-Q3']);
  assert.match(PAGE, /api\.hqRevenue\(period \|\| undefined\)/, 'the picked period does not reach the summary read');
});
