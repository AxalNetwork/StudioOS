/**
 * D5956 (#5956) — HQ's one-off initial invoice card (boards L41 to L45) and the Apply review's "Goes to" rows (L47, L48),
 * against stubbed reads. The Worker's half is cloudflare-worker/test/licence_fee_invoices_d802.test.ts (the D5954 cases).
 * Each case names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_initial_invoice_5956.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import LicenceFeeInvoices from '../src/pages/admin/LicenceFeeInvoices.jsx';
import { CountryPricing } from '../src/pages/admin/licences/CountryPricing.jsx';
import { dayLabel, initialInvoiceCard, regulatoryClassLabel, splitInvoices } from '../src/pages/admin/licenceFeeInvoicesModel.js';
import { applyDestinations, figure, issueFromBillingNext } from '../src/pages/admin/licences/countryPricingModel.js';
import { licenceConsequence } from '../src/pages/admin/licenceConsequenceModel.js';

const h = React.createElement;
const TODAY = '2026-11-21';
// Invented values throughout; the licence, references and figures are fixtures.
const LICENCE = { uid: 'lic_x', status: 'active', starts_on: '2026-11-01' };
const DECISION = { uid: 'dec_1', decision: 'accepted', currency: 'EUR', created_at: '2026-11-12T10:00:00Z', effective_from: '2026-11-12',
  accepted: { initial_fee_cents: 5_000_000, annual_fee_cents: 4_500_000, royalty_bps: 550, minimum_royalty_cents: 1_800_000, regulatory_surcharge_cents: 800_000 } };
const PRICING = { terms: { currency: 'EUR' }, countries: [{ country_code: 'XX', recorded: true, regulatory_class: 'high' }], latest_decision: DECISION };
const INITIAL = { uid: 'inv_i', kind: 'initial', period_label: 'Initial fee', amount_cents: 5_800_000, currency: 'EUR', paid_cents: 0,
  initial_fee_cents: 5_000_000, regulatory_surcharge_cents: 800_000, pricing_decision_uid: 'dec_1', reference: 'AXAL-LIC-TEST-INITIAL',
  issued_at: '2026-11-13', due_at: '2026-12-13', status: 'issued', void_note: null, revision: 0, pdf_url: '/api/admin/licences/lic_x/fee-invoices/inv_i/pdf' };
const ANNUAL = { uid: 'inv_a', kind: 'annual', period_label: '2026–27', amount_cents: 4_200_000, currency: 'EUR', paid_cents: 0, reference: 'AXAL-LIC-TEST-2026-27',
  issued_at: '2026-11-02', due_at: '2026-12-02', status: 'issued', revision: 0, pdf_url: '/x' };
const ready = (data) => ({ status: 'ready', data });
const card = (o = {}) => initialInvoiceCard({ licence: LICENCE, invoicesRead: ready({ invoices: [] }), pricingRead: ready(PRICING), today: TODAY, ...o });

// 1 ───────────────────────────────────────────────────────────────────────────
test('not yet issued: two lines and a total in the decision\'s currency, and Issue offered', () => {
  // Mutations checked: the surcharge line dropped; the total missing the surcharge; Issue offered with no decision.
  const c = card();
  assert.equal(c.state, 'ready');
  assert.equal(c.canIssue, true);
  assert.deepEqual(c.lines.map((l) => [l.label, l.amount]), [['Initial licence fee', '€50,000.00'], ['Regulatory surcharge · class high', '€8,000.00']]);
  assert.equal(c.total, '€58,000.00');
  assert.equal(c.chip.word, 'Not issued');
  assert.equal(splitInvoices([ANNUAL, INITIAL]).initial, INITIAL);
  assert.deepEqual(splitInvoices([ANNUAL, INITIAL]).annual, [ANNUAL]);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('Not recorded, Unavailable and €0 never look alike', () => {
  // Mutations checked: a missing surcharge drawn as €0; an unreadable invoice list allowing Issue; a missing fee allowing Issue.
  const nrSur = card({ pricingRead: ready({ ...PRICING, latest_decision: { ...DECISION, accepted: { ...DECISION.accepted, regulatory_surcharge_cents: null } } }) });
  assert.equal(nrSur.state, 'nrsur');
  assert.equal(nrSur.nrSurcharge, true);
  assert.equal(nrSur.lines.length, 1, 'no €0 line is printed');
  assert.equal(nrSur.total, '€50,000.00');
  assert.equal(nrSur.canIssue, true);
  const zeroSur = card({ pricingRead: ready({ ...PRICING, latest_decision: { ...DECISION, accepted: { ...DECISION.accepted, regulatory_surcharge_cents: 0 } } }) });
  assert.equal(zeroSur.nrSurcharge, false, 'a surcharge recorded as zero is not "Not recorded"');
  assert.equal(zeroSur.lines.length, 1);
  const nrFee = card({ pricingRead: ready({ ...PRICING, latest_decision: { ...DECISION, accepted: { ...DECISION.accepted, initial_fee_cents: null } } }) });
  assert.equal(nrFee.state, 'nrfee');
  assert.equal(nrFee.canIssue, false);
  assert.equal(nrFee.total, null);
  assert.equal(nrFee.lines[0].amount, 'Not recorded');
  const invUnread = card({ invoicesRead: { status: 'unreadable', data: null } });
  assert.equal(invUnread.state, 'invunread');
  assert.equal(invUnread.chip.word, 'Unavailable');
  assert.equal(invUnread.canIssue, false);
  assert.match(invUnread.why, /one may already be issued/);
  const decUnread = card({ pricingRead: { status: 'unreadable', data: null } });
  assert.equal(decUnread.state, 'decunread');
  assert.match(decUnread.why, /unknown, not zero/);
  assert.equal(card({ pricingRead: ready({ ...PRICING, latest_decision: null }) }).state, 'nodecision');
  assert.equal(card({ invoicesRead: { status: 'loading' } }).state, 'loading');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the licence\'s own state: not started, no start date, not billable', () => {
  // Mutations checked: a licence starting later allowed to issue; a draft licence offered Issue; the start date sentence dropped.
  const later = card({ licence: { ...LICENCE, starts_on: '2026-12-01' } });
  assert.equal(later.state, 'notstarted');
  assert.equal(later.canIssue, false);
  assert.match(later.why, /Can be issued from 1 Dec 2026/);
  const noStart = card({ licence: { ...LICENCE, starts_on: null } });
  assert.equal(noStart.state, 'nostart');
  assert.match(noStart.why, /Start date Not recorded/);
  for (const status of ['draft', 'pending_activation', 'terminated']) {
    const c = card({ licence: { ...LICENCE, status } });
    assert.equal(c.state, 'notbill', status);
    assert.equal(c.issueShown, false, status);
  }
  assert.equal(card({ licence: { ...LICENCE, status: 'suspended' } }).state, 'ready');
  assert.equal(dayLabel('2026-12-01'), '1 Dec 2026');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('issued, part paid, paid, overdue and void: what each offers', () => {
  // Mutations checked: Void offered once a payment is recorded; a void invoice allowing Record payment; Overdue ignoring the due date.
  const at = (inv, today = TODAY) => card({ invoicesRead: ready({ invoices: [inv] }), today });
  const issued = at(INITIAL);
  assert.equal(issued.state, 'issued');
  assert.equal(issued.issueShown, false, 'a second initial invoice is never offered');
  assert.ok(issued.record && issued.voidable);
  assert.equal(issued.total, '€58,000.00');
  assert.deepEqual(issued.meta.find(([k]) => k === 'Reference'), ['Reference', 'AXAL-LIC-TEST-INITIAL']);
  const part = at({ ...INITIAL, paid_cents: 2_000_000 });
  assert.equal(part.state, 'part');
  assert.equal(part.voidable, false);
  assert.match(part.why, /only an invoice with nothing paid can be voided/);
  const paid = at({ ...INITIAL, paid_cents: 5_800_000, status: 'paid' });
  assert.equal(paid.state, 'paid');
  assert.equal(paid.record, false);
  const overdue = at(INITIAL, '2026-12-21');
  assert.equal(overdue.state, 'overdue');
  assert.match(overdue.chip.word, /Overdue · 8 days/);
  const voided = at({ ...INITIAL, status: 'void', void_note: 'Licensee entity named wrongly' });
  assert.equal(voided.state, 'void');
  assert.equal(voided.record, false);
  assert.equal(voided.voidable, false);
  assert.equal(voided.issueShown, false);
  assert.match(voided.why, /no second one can be issued/);
  assert.match(voided.meta.find(([k]) => k === 'PDF')[1], /Hidden/);
  assert.equal(regulatoryClassLabel([{ country_code: 'AA', recorded: true, regulatory_class: 'high' }, { country_code: 'BB', recorded: true, regulatory_class: null }]), 'class AA high · BB Not recorded');
});

// 5 ───────────────────────────────────────────────────────────────────────────
async function mountFees({ list, pricing, issueInitial }) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const api = { list, issue: async () => ({}), issueInitial, recordPayment: async () => ({}), voidInvoice: async () => ({}), pdfBlob: async () => ({}) };
  await act(async () => { root.render(h(LicenceFeeInvoices, { licence: LICENCE, api, pricingApi: { get: pricing }, today: TODAY })); await settle(); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    by, props, text: (n) => text(n || container),
    click: (id) => act(async () => { props(by(id)).onClick(); await settle(); await settle(); }),
    clickNoWait: (id) => act(async () => { props(by(id)).onClick(); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the Billing view: the card above the annual list, Issue through the review sheet, a refusal shown as the Worker gives it', async () => {
  // Mutations checked: the initial invoice left in the annual list; Issue sent without the sheet; the Worker's sentence replaced.
  const calls = [];
  let invoices = [ANNUAL];
  const m = await mountFees({
    list: async () => { calls.push('list'); return { invoices, annual_fee_cents: 4_200_000, currency: 'EUR', starts_on: LICENCE.starts_on }; },
    pricing: async () => PRICING,
    issueInitial: async (uid) => { calls.push(`initial:${uid}`); invoices = [INITIAL, ANNUAL]; return {}; },
  });
  try {
    assert.equal(m.props(m.by('initial-invoice'))['data-state'], 'ready');
    assert.match(m.text(m.by('initial-invoice-lines')), /€8,000\.00/);
    await m.clickNoWait('initial-invoice-issue');
    assert.ok(m.by('licence-consequence-sheet'), 'Issue asks in the review sheet first');
    assert.match(m.text(m.by('licence-consequence-sheet')), /A second initial invoice can never be issued, even after a void/);
    assert.ok(!calls.some((c) => c.startsWith('initial:')), 'nothing is issued before the sheet is confirmed');
    await m.click('licence-consequence-cancel');
    assert.ok(!calls.some((c) => c.startsWith('initial:')), 'Cancel issues nothing');
    await m.clickNoWait('initial-invoice-issue');
    await m.click('licence-consequence-confirm');
    assert.ok(calls.includes('initial:lic_x'));
    assert.equal(m.props(m.by('initial-invoice'))['data-state'], 'issued');
    assert.ok(!m.by('initial-invoice-issue'), 'no second Issue');
    assert.ok(m.by('fee-invoice-inv_a'), 'the annual invoice is still listed');
    assert.ok(!m.by('fee-invoice-inv_i'), 'the initial invoice is not an annual row');
  } finally { await m.unmount(); }

  const refused = await mountFees({
    list: async () => ({ invoices: [], annual_fee_cents: 4_200_000, currency: 'EUR', starts_on: LICENCE.starts_on }),
    pricing: async () => PRICING,
    issueInitial: async () => { throw Object.assign(new Error('refused'), { status: 409, data: { error: 'licence_not_started', message: 'This licence starts on 2026-12-01. Its initial fee is invoiced from that day.' } }); },
  });
  try {
    await refused.clickNoWait('initial-invoice-issue');
    await refused.click('licence-consequence-confirm');
    const out = refused.by('fee-invoices-write-outcome');
    assert.equal(refused.props(out)['data-outcome'], 'refused');
    assert.match(refused.text(out), /This licence starts on 2026-12-01\. Its initial fee is invoiced from that day\./);
  } finally { await refused.unmount(); }

  const noDecision = await mountFees({ list: async () => ({ invoices: [] }), pricing: async () => ({ ...PRICING, latest_decision: null }) });
  try {
    assert.ok(noDecision.by('initial-invoice-open-pricing'));
    assert.equal(noDecision.props(noDecision.by('initial-invoice-open-pricing')).href, '/admin/licences/lic_x/terms');
  } finally { await noDecision.unmount(); }
});

// 6 ───────────────────────────────────────────────────────────────────────────
const VIEW = {
  licence_uid: 'lic_x', terms: { annual_fee_cents: 4_200_000, revenue_share_bps: 600, minimum_guarantee_cents: 1_680_000, currency: 'EUR', terms_revision: 7 },
  countries: [{ country_code: 'XX', recorded: true, regulatory_class: 'high' }], latest_decision: null,
  recommendation: { uid: 'snap_1', currency: 'EUR', available: true, basis: 'primary_country',
    recommended: { initial_fee_cents: 5_000_000, annual_fee_cents: 4_500_000, royalty_bps: 550, minimum_royalty_cents: 1_800_000, regulatory_surcharge_cents: 800_000 } },
};
const none = { status: 'ready', data: { invoices: [] } };

test('the Apply review: five figures, before → after, each with where it goes', () => {
  // Mutations checked: the minimum royalty sent to core terms; the initial fee drawn as going to the invoice once one is issued; a Not recorded figure drawn as 0; an unreadable list read as none.
  const rows = applyDestinations({ view: VIEW, form: {}, invoices: none });
  assert.deepEqual(rows.map((r) => r.key), ['annual_fee_cents', 'royalty_bps', 'minimum_royalty_cents', 'initial_fee_cents', 'regulatory_surcharge_cents']);
  assert.deepEqual(rows.map((r) => r.goesTo), ['Core terms', 'Core terms', 'Schedule § 4.4 minimum guarantee', 'One-off initial invoice, issued from Billing', 'One-off initial invoice, billed once with the initial fee']);
  assert.equal(rows[0].before, figure(4_200_000, 'cents', 'EUR'));
  assert.equal(rows[0].after, figure(4_500_000, 'cents', 'EUR'));
  assert.equal(rows[2].after, figure(1_800_000, 'cents', 'EUR'));
  assert.equal(rows[4].label, 'Regulatory surcharge · class high');
  assert.equal(rows[3].before, 'Not recorded');

  const nr = applyDestinations({ view: { ...VIEW, recommendation: { ...VIEW.recommendation, recommended: { ...VIEW.recommendation.recommended, minimum_royalty_cents: null, regulatory_surcharge_cents: null } } }, form: {}, invoices: none });
  assert.equal(nr[2].after, 'Not recorded');
  assert.equal(nr[2].goesTo, `Not recorded · no change · Schedule § 4.4 keeps ${figure(1_680_000, 'cents', 'EUR')}`);
  assert.match(nr[4].goesTo, /Never written as €0/);

  const issued = applyDestinations({ view: VIEW, form: {}, invoices: { status: 'ready', data: { invoices: [INITIAL] } } });
  assert.match(issued[3].goesTo, /Recorded on the decision only · invoice AXAL-LIC-TEST-INITIAL already issued/);
  assert.equal(issued[4].goesTo, `Recorded on the decision only · the issued invoice keeps ${figure(800_000, 'cents', 'EUR')}`);

  const unknown = applyDestinations({ view: VIEW, form: {}, invoices: { status: 'unreadable' } });
  assert.match(unknown[3].goesTo, /whether one is issued is unknown/);
  assert.equal(unknown[0].goesTo, 'Core terms', 'core figures do not depend on the invoice read');

  const typed = applyDestinations({ view: VIEW, form: { accepted: { annual_fee_cents: '46000' } }, invoices: none });
  assert.equal(typed[0].after, figure(4_600_000, 'cents', 'EUR'));

  assert.deepEqual(issueFromBillingNext({ view: VIEW, form: {}, invoices: none }), { text: 'Initial invoice: issue it from Billing', href: '/admin/licences/lic_x/fee-invoices' });
  assert.equal(issueFromBillingNext({ view: VIEW, form: {}, invoices: { status: 'ready', data: { invoices: [INITIAL] } } }), null);
  assert.equal(issueFromBillingNext({ view: { ...VIEW, recommendation: { ...VIEW.recommendation, recommended: { ...VIEW.recommendation.recommended, initial_fee_cents: null } } }, form: {}, invoices: none }), null);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the mounted Apply review lists the destinations and asks for the agreement when the minimum guarantee changes', async () => {
  // Mutations checked: the destinations table not drawn; the acknowledgement missing when only the minimum guarantee changes; the old "annual fee and royalty above" sentence kept.
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const view = { ...VIEW, territory: ['XX'], basis: { basis: 'primary_country', implied: true, policy: null }, model: { uid: 'm', version: 'v3', currency: 'EUR' },
    recommendation: { ...VIEW.recommendation, created_at: '2026-11-11T00:00:00Z', components: [], trace: { components: [] },
      recommended: { ...VIEW.recommendation.recommended, annual_fee_cents: 4_200_000, royalty_bps: 600 } },
    drift: {}, reviews: [], agreement: { state: 'matches' }, recommendation_reason: null };
  const api = { get: async () => view };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  try {
    await act(async () => { root.render(h(CountryPricing, { licence: { uid: 'lic_x' }, api, invoicesApi: { list: async () => ({ invoices: [] }) } })); await settle(); await settle(); });
    assert.doesNotMatch(textOf(container), /applying it changes the annual fee and royalty above/);
    assert.match(textOf(container), /minimum royalty into the schedule’s § 4\.4 minimum guarantee/);
    await act(async () => { props(by('pricing-apply')).onClick(); await settle(); });
    assert.ok(by('pricing-apply-destinations'));
    assert.equal(props(by('pricing-dest-minimum_royalty_cents'))['data-tone'], 'goes');
    assert.ok(by('pricing-ack'), 'only the minimum guarantee changes, and the acknowledgement is still asked');
    assert.match(textOf(container), /the annual fee, the royalty or the minimum guarantee/);
  } finally { await act(async () => root.unmount()); restore(); }
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('the review sheet names the lines, the total and what can never happen twice', () => {
  // Mutations checked: the Not recorded surcharge printed as a €0 line; the undo sentence claiming a second invoice.
  const s = licenceConsequence('issueInitialInvoice', LICENCE, { target: { lines: [{ label: 'Initial licence fee', amount: '€50,000.00', note: 'one-off' }], total: '€50,000.00', nrSurcharge: true } });
  assert.equal(s.confirm, 'Issue initial invoice');
  assert.ok(s.happens.some((x) => x.text === 'Regulatory surcharge: Not recorded' && /No €0 line/.test(x.note)));
  assert.ok(s.happens.some((x) => /One invoice for €50,000\.00 is issued and frozen/.test(x.text)));
  assert.match(s.undo.text, /The one initial invoice stays used/);
  assert.equal(s.reason.min, null);
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('the client issues the initial invoice on the mounted POST, with kind "initial"', () => {
  const src = readFileSync(new URL('../src/lib/api/licenceFeeInvoices.js', import.meta.url), 'utf8');
  assert.match(src, /issueInitial: \(licenceUid\) => request\(`\/admin\/licences\/\$\{enc\(licenceUid\)\}\/fee-invoices`, \{ method: 'POST', body: JSON\.stringify\(\{ kind: 'initial' \}\) \}\)/);
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/admin_licences_fees.ts', import.meta.url), 'utf8');
  assert.match(route, /r\.post\('\/:uid\/fee-invoices'/);
  assert.match(route, /kind === 'initial'/);
});
