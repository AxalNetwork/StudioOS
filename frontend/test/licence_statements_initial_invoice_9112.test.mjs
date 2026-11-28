// D9112 (L46): licensee Statements from the Worker's invoice response.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatementsView } from '../src/pages/subsidiary/licence/StatementsTab.jsx';
import { renderedText } from './_renderedText.mjs';

const NOW = new Date('2026-11-27T12:00:00Z');
before(() => test.mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => test.mock.timers.reset());

const annual = {
  uid: 'sample-annual', kind: 'annual', period_label: '2026–27', period_start: '2026-11-01', period_end: '2027-10-31',
  amount_cents: 4_200_000, currency: 'EUR', paid_cents: 4_200_000, outstanding_cents: 0,
  reference: 'AXL-XX-001-2026', issued_at: '2026-11-01', due_at: '2026-12-01', status: 'paid', paid_at: '2026-11-22',
  pdf_url: '/api/licence/mine/fee-invoices/sample-annual/pdf',
};
const initial = {
  ...annual, uid: 'sample-initial', kind: 'initial', period_label: 'Initial', period_end: '2026-11-01',
  amount_cents: 5_800_000, paid_cents: 0, outstanding_cents: 5_800_000, initial_fee_cents: 5_000_000,
  regulatory_surcharge_cents: 800_000, reference: 'AXL-XX-001-INITIAL', status: 'issued', paid_at: null,
  pdf_url: '/api/licence/mine/fee-invoices/sample-initial/pdf',
};

function render(answer) {
  return renderToStaticMarkup(createElement(StatementsView, { answer: { available: true, ...answer }, onReload() {} }));
}
function section(html, name) {
  return html.match(new RegExp(`<section[^>]*data-testid="${name}"[^>]*>[\\s\\S]*?</section>`))?.[0] ?? '';
}

test('L46 puts the read-only initial invoice before annual invoices and royalties', () => {
  const html = render({ fee_invoices: [annual, initial] });
  const card = section(html, 'initial-invoice');
  const table = section(html, 'fee-invoices');
  assert.ok(card && table && section(html, 'royalty-statements'));
  assert.ok(html.indexOf(card) < html.indexOf(table) && html.indexOf(table) < html.indexOf('data-testid="royalty-statements"'));
  assert.match(renderedText(card), /Initial invoice · one-offIssued/);
  assert.match(renderedText(card), /Initial licence fee€50,000\.00Regulatory surcharge€8,000\.00Total€58,000\.00/);
  assert.match(renderedText(card), /ReferenceAXL-XX-001-INITIALIssued1 Nov 2026Due1 Dec 2026Paid so far€0\.00 of €58,000\.00/);
  assert.ok(card.includes(`href="${initial.pdf_url}"`));
  assert.doesNotMatch(card, /<button|class high|Record payment|Pricing &amp; Market/);
  assert.match(renderedText(table), /2026–27AXL-XX-001-2026€42,000\.001 Dec 2026PaidPDF/);
  assert.ok(table.includes(`href="${annual.pdf_url}"`));
  assert.doesNotMatch(table, /sample-initial|AXL-XX-001-INITIAL/);
});

test('L46 omits a null surcharge line and omits the card when no initial invoice exists', () => {
  const card = section(render({ fee_invoices: [{ ...initial, regulatory_surcharge_cents: null, amount_cents: 5_000_000 }] }), 'initial-invoice');
  assert.match(renderedText(card), /Initial licence fee€50,000\.00Total€50,000\.00/);
  assert.doesNotMatch(renderedText(card), /Regulatory surcharge€/);
  const empty = render({ fee_invoices: [] });
  assert.equal(section(empty, 'initial-invoice'), '');
  assert.match(renderedText(section(empty, 'fee-invoices')), /No annual fee invoice has been issued\./);
});

test('L46 renders each issued state and hides a void invoice PDF', () => {
  const cases = [
    [{}, 'Issued'],
    [{ paid_cents: 200_000 }, 'Part paid'],
    [{ due_at: '2026-11-19', paid_cents: 200_000 }, 'Overdue · 8 days'],
    [{ due_at: '2026-11-26' }, 'Overdue · 1 day'],
    [{ status: 'paid', due_at: '2026-11-10', paid_cents: 5_800_000 }, 'Paid'],
  ];
  for (const [fields, label] of cases) {
    const card = section(render({ fee_invoices: [{ ...initial, ...fields }] }), 'initial-invoice');
    assert.ok(renderedText(card).startsWith(`Initial invoice · one-off${label}Initial licence fee`), label);
  }
  // Even an old response with a PDF URL must not offer the void invoice.
  const voided = section(render({ fee_invoices: [{ ...initial, status: 'void' }] }), 'initial-invoice');
  assert.match(voided, /<s>Void<\/s>/);
  assert.match(renderedText(voided), /Paid so far—PDFHidden · a void invoice prints nothing/);
  assert.doesNotMatch(voided, /<a\b/);
});

test('L46B shows the read failure and Try again while the other sections remain', () => {
  for (const [fields, reason] of [
    [{ fee_invoices: null, fee_invoices_reason: 'The sample fee invoice read failed.' }, 'The sample fee invoice read failed.'],
    [{}, 'Your fee invoices could not be read. Try again in a moment.'],
  ]) {
    const html = render(fields);
    const failure = section(html, 'fee-invoices-unavailable');
    assert.ok(renderedText(failure).includes(`Unavailable${reason} Statements below still show.`));
    assert.match(failure, /<button[^>]*>[\s\S]*Try again/);
    assert.equal(section(html, 'initial-invoice'), '');
    assert.equal(section(html, 'fee-invoices'), '');
    for (const panel of ['royalty-statements', 'how-to-pay', 'usage-reports']) assert.ok(section(html, panel));
  }
});
