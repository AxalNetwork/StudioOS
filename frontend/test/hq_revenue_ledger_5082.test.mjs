/**
 * D5082 (#5082) — the executive summary's four ledger positions (Invoiced, Collected, Outstanding, Overdue) read
 * the licence-fee invoice ledger the Worker sends as `licence_invoices` (D5036, #5132):
 *
 *   - per native currency, never summed or converted;
 *   - Invoiced and Collected carry the period, Outstanding and Overdue "As of now";
 *   - absent field → one row of Not recorded (main before #5132); unreadable → Unavailable; neither is ever 0;
 *   - a currency the readable ledger holds nothing in, beside one it does, is a measured zero;
 *   - the ledger's one explanation lives in the coverage drawer, which turns Partial (licence fees only).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LEDGER_REASON, coverageSources, ledgerPosition, ledgerReason } from '../src/pages/hq/revenue/revenueModel.js';
import { ExecutiveSummary } from '../src/pages/hq/revenue/ExecutiveSummary.jsx';

const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const BASE = {
  quarter: { key: '2026-Q4', label: 'Q4 2026' }, current_period: '2026-Q4',
  temporal: { licence_fees: 'as_of_now', licence_invoices: 'period' },
  licence_fees: { available: true, basis: 'One quarter of each active annual fee.', active_without_fee: 0, by_currency: [{ currency: 'EUR', licences: 2, quarter_cents: 500_000 }] },
  token_cost: { available: false }, usage_coverage: { available: false },
};
const INVOICES = {
  available: true, source: 'licence_fee_invoices', as_of: '2026-11-09',
  by_currency: [
    { currency: 'EUR', invoices: 3, invoiced_cents: 12_840_000, collected_cents: 11_290_000, outstanding_cents: 1_550_000, overdue_invoices: 1, overdue_cents: 420_000, void_invoices: 0, void_cents: 0 },
  ],
  receivable_by_currency: [
    { currency: 'EUR', open_invoices: 2, outstanding_cents: 1_550_000, overdue_invoices: 1, overdue_cents: 420_000 },
    { currency: 'GBP', open_invoices: 1, outstanding_cents: 300_000, overdue_invoices: 0, overdue_cents: 0 },
  ],
  overdue: [], overdue_total: 1, expected_not_invoiced: [{ licence_uid: 'pt' }], cannot_invoice: [],
};
const withInvoices = (inv) => ({ ...BASE, licence_invoices: inv });
const render = (summary) => html(React.createElement(ExecutiveSummary, { summary, refunds: { available: true, by_currency: [] }, disputes: { disputes: [] }, period: '2026-Q4' }));
const ledgerBlock = (h) => h.split('data-testid="hq-revenue-ledger-tiles"')[1].split('data-testid="hq-revenue-position-')[0];

test('D5082: before the Worker sends licence_invoices, the four positions stay one row of Not recorded', () => {
  assert.equal(ledgerPosition(BASE).state, 'not_recorded');
  const block = ledgerBlock(render(BASE));
  assert.match(block, /^ data-ledger-state="not_recorded"/);
  const t = text(block);
  for (const l of ['Invoiced', 'Collected', 'Outstanding', 'Overdue']) assert.match(t, new RegExp(`${l} Not recorded`));
  assert.doesNotMatch(block, /[€£$]\s?0|0\.00/);
});

test('D5082: the read ledger is drawn per native currency: Invoiced and Collected for the period, Outstanding and Overdue as of now', () => {
  const h = render(withInvoices(INVOICES));
  const block = ledgerBlock(h);
  assert.match(block, /^ data-ledger-state="recorded"/);
  const eur = text(block.split('data-testid="hq-revenue-ledger-EUR"')[1].split('data-testid="hq-revenue-ledger-GBP"')[0]);
  assert.match(eur, /Invoiced €128,400(\.00)? Q4 2026[^]*?3 invoices/);
  assert.match(eur, /Collected €112,900(\.00)? Q4 2026/);
  // Outstanding and Overdue are the receivable as at today, not the period's invoices.
  assert.match(eur, /Outstanding €15,500(\.00)? As of now[^]*?2 open invoices/);
  assert.match(eur, /Overdue €4,200(\.00)? As of now[^]*?1 invoice past due/);
  const gbp = text(block.split('data-testid="hq-revenue-ledger-GBP"')[1]);
  // GBP has an open invoice but none issued this period: a measured zero, in its own currency.
  assert.match(gbp, /Invoiced £0(\.00)?[^]*?Zero[^]*?Q4 2026/);
  assert.match(gbp, /Outstanding £3,000(\.00)? As of now/);
  // Mutation checked: summing the buckets draws a total that names no currency.
  assert.doesNotMatch(text(block), /Total|All currencies/i);
  assert.match(text(block), /1 licence year has started without an invoice/);
  assert.match(text(block), /Licence fees · invoice ledger/);
});

test('D5082: the overdue tile is marked for attention only when something is overdue', () => {
  const eur = ledgerBlock(render(withInvoices(INVOICES))).split('data-testid="hq-revenue-ledger-EUR"')[1].split('data-testid="hq-revenue-ledger-GBP"')[0];
  assert.equal((eur.match(/border-amber-300/g) || []).length, 1);
  const gbp = ledgerBlock(render(withInvoices(INVOICES))).split('data-testid="hq-revenue-ledger-GBP"')[1];
  assert.equal((gbp.match(/border-amber-300/g) || []).length, 0);
});

test('D5082: an unreadable ledger is Unavailable, never 0, and its reason lives in the drawer', () => {
  const s = withInvoices({ available: false, reason: 'The licence-fee invoice ledger could not be read.' });
  const pos = ledgerPosition(s);
  assert.equal(pos.state, 'unavailable');
  const block = ledgerBlock(render(s));
  assert.match(text(block), /Invoiced Unavailable/);
  assert.doesNotMatch(block, /[€£$]\s?0|0\.00/);
  const src = coverageSources({ summary: s, statements: null, disputes: null, refunds: null, ceilings: null, period: '2026-Q4' }).find((x) => x.key === 'ledger');
  assert.equal(src.state, 'unavailable');
  assert.match(src.reason, /could not be read/);
});

test('D5082: a readable ledger with no invoice in any currency says None, not a currency it never held', () => {
  const s = withInvoices({ ...INVOICES, by_currency: [], receivable_by_currency: [], expected_not_invoiced: [] });
  const block = ledgerBlock(render(s));
  assert.match(block, /data-testid="hq-revenue-ledger-none"/);
  assert.match(text(block), /Invoiced None[^]*?Q4 2026[^]*?No licence invoice issued/);
  assert.doesNotMatch(block, /[€£$]/);
});

test('D5082: the coverage drawer turns Partial and names what the ledger leaves out; the old reason goes', () => {
  const src = coverageSources({ summary: withInvoices(INVOICES), statements: null, disputes: null, refunds: null, ceilings: null, period: '2026-Q4' }).find((x) => x.key === 'ledger');
  assert.equal(src.state, 'partial');
  assert.notEqual(src.reason, LEDGER_REASON);
  assert.match(src.reason, /Licence-fee invoices only/);
  assert.match(src.reason, /Subscription revenue/);
  assert.match(src.reason, /1 licence year has started without an invoice/);
  assert.equal(ledgerReason({ expectedNotInvoiced: 0, cannotInvoice: 2 }).includes('2 billable licences cannot be invoiced'), true);
  // Before the field exists, the drawer keeps the old Not recorded reason.
  const before = coverageSources({ summary: BASE, statements: null, disputes: null, refunds: null, ceilings: null, period: '2026-Q4' }).find((x) => x.key === 'ledger');
  assert.deepEqual([before.state, before.reason], ['not_recorded', LEDGER_REASON]);
});

test('D5082: a summary still loading draws Loading, not Not recorded', () => {
  assert.equal(ledgerPosition(null).state, 'loading');
  const block = ledgerBlock(render(null));
  assert.match(block, /^ data-ledger-state="loading"/);
  assert.doesNotMatch(text(block), /Not recorded/);
});
