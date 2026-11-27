/**
 * D5036 part 2 (#5036) — Revenue streams' licence row reads the licence-fee invoice ledger.
 *
 * D5082 drew `licence_invoices` in the executive summary, while the streams table kept the licence row's Invoiced
 * and Collected at Not recorded. That row now reads the same field, per currency:
 *
 *   - Without the field the cells stay Not recorded and the row is "Run-rate only".
 *   - An unreadable ledger is Unavailable, never 0.
 *   - A currency with a run-rate and no invoice in a readable ledger is a measured zero in that currency.
 *   - A currency the period's invoices hold, with no active licence priced in it, gets its own row.
 *   - Currencies are never summed, and there is no total row.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_revenue_streams_invoices_5036.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { invoiceOnlyCurrencies, licenceStreamCells } from '../src/pages/hq/revenue/revenueModel.js';
import { RevenueStreams } from '../src/pages/hq/revenue/RevenueStreams.jsx';

const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const BASE = {
  quarter: { key: '2026-Q4', label: 'Q4 2026' }, current_period: '2026-Q4',
  temporal: { licence_fees: 'as_of_now', licence_invoices: 'period' },
  licence_fees: {
    available: true, basis: 'One quarter of each active annual fee.', active_without_fee: 0,
    by_currency: [{ currency: 'EUR', licences: 2, quarter_cents: 500_000 }, { currency: 'GBP', licences: 1, quarter_cents: 250_000 }],
  },
  token_cost: { available: false }, usage_coverage: { available: false },
};
const INVOICES = {
  available: true, source: 'licence_fee_invoices', as_of: '2026-11-09',
  by_currency: [
    { currency: 'EUR', invoices: 3, invoiced_cents: 12_840_000, collected_cents: 11_290_000, outstanding_cents: 1_550_000, overdue_invoices: 1, overdue_cents: 420_000, void_invoices: 1, void_cents: 999_900 },
    { currency: 'USD', invoices: 1, invoiced_cents: 700_000, collected_cents: 0, outstanding_cents: 700_000, overdue_invoices: 0, overdue_cents: 0, void_invoices: 0, void_cents: 0 },
  ],
  receivable_by_currency: [{ currency: 'EUR', open_invoices: 2, outstanding_cents: 1_550_000, overdue_invoices: 1, overdue_cents: 420_000 }],
  overdue: [], overdue_total: 1, expected_not_invoiced: [], cannot_invoice: [],
};
const streams = (summary) => text(html(React.createElement(RevenueStreams, { summary, periodStatements: null, period: '2026-Q4' })));
const row = (t, cur) => t.split(`Licence fees · ${cur}`)[1].split(/Licence fees · |Revenue-share statements/)[0];

test('without licence_invoices the licence row keeps Not recorded and says Run-rate only', () => {
  const t = streams(BASE);
  assert.match(row(t, 'EUR'), /€5,000\.00 Not recorded[^]*Not recorded[^]*Run-rate only/);
  assert.equal(invoiceOnlyCurrencies(BASE, ['EUR']).length, 0);
});

test('a read ledger fills Invoiced and Collected for the period, in the row\'s own currency, apart from the run-rate', () => {
  // Mutations checked: the cells left at Not recorded; collected drawn as invoiced; another currency's invoices drawn.
  const t = streams({ ...BASE, licence_invoices: INVOICES });
  const eur = row(t, 'EUR');
  assert.match(eur, /€5,000\.00 €128,400\.00 €112,900\.00/, 'run-rate, invoiced and collected, each its own figure');
  assert.match(eur, /Run-rate and invoices/);
  assert.doesNotMatch(eur, /Not recorded/);
  assert.doesNotMatch(eur, /9,999/, 'a void invoice reached the invoiced cell');
  // GBP has a run-rate and no invoice issued in the period: a measured zero in pounds, not Not recorded and not euros.
  assert.match(row(t, 'GBP'), /£2,500\.00 £0\.00[^]*£0\.00/);
  assert.doesNotMatch(t, /total/i, 'a total row appeared');
});

test('invoices in a currency no active licence is priced in get their own row, never folded into another', () => {
  // Mutation checked: invoice-only currencies left undrawn.
  const summary = { ...BASE, licence_invoices: INVOICES };
  assert.deepEqual(invoiceOnlyCurrencies(summary, ['EUR', 'GBP']), ['USD']);
  const usd = row(streams(summary), 'USD');
  assert.match(usd, /No active licence[^]*No active licence fee[^]*\$7,000\.00[^]*\$0\.00/);
});

test('an unreadable ledger is Unavailable in the licence row, never 0', () => {
  // Mutation checked: an unreadable ledger drawn as zero.
  const summary = { ...BASE, licence_invoices: { available: false, reason: 'The licence-fee invoice ledger could not be read.' } };
  const cells = licenceStreamCells(summary, 'EUR');
  assert.equal(cells.invoiced.state, 'unavailable');
  assert.equal(cells.collected.state, 'unavailable');
  const eur = row(streams(summary), 'EUR');
  assert.doesNotMatch(eur, /€0\.00/);
  assert.match(eur, /Run-rate only/);
});
