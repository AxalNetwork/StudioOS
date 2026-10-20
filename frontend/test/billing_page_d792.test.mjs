/**
 * D792 (#2217) — the Billing page (B3 of the "Usage & Billing console"
 * canvas): Token balance, Included with your plan, Buy tokens with D790's
 * live offers, the plan and Payment details beside Auto-reload (D794, with
 * D788's spend limit), then the orders. Each card's states, Buy's link to the
 * existing checkout, and the phone layout.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/billing_page_d792.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { BuyTokensCard, PaymentDetailsCard, PlanAllowanceCard, TokenBalanceCard } from '../src/pages/account/BillingCards.jsx';
import { NO_CARD, NO_PLAN, TOKENS_FOOTNOTE, allowanceView, balanceText, nextReset, packCards, paymentCard } from '../src/pages/account/billingModel.js';
import { AutoReloadForm } from '../src/pages/account/AutoReloadCard.jsx';
import { limitLine, pausedLine } from '../src/pages/account/autoReloadModel.js';

const h = React.createElement;
const NOW = new Date('2026-10-20T12:00:00Z');
const ready = (data) => ({ status: 'ready', data, reload: () => {} });
const LOADING = { status: 'loading', data: null, reload: () => {} };
const UNREADABLE = { status: 'unreadable', data: null, message: '', reload: () => {} };

async function mount(element) {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    text: () => textOf(container).replace(/\s+/g, ' ').trim(),
    textOf: (id) => textOf(byTestId(id)).replace(/\s+/g, ' ').trim(),
    byTestId, props,
    async click(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

// ------------------------------------------------------------------ the rules

test('the token balance and the plan allowance: left of what, resets on the 1st (UTC), or no plan', () => {
  assert.equal(balanceText({ balance_microusd: 27_500_000 }), '$27.50');
  assert.equal(balanceText({ balance_microusd: 0 }), '$0.00');
  assert.equal(balanceText({}), null, 'no figure is guessed');
  assert.equal(nextReset(NOW).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextReset(new Date('2026-12-31T23:59:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  const me = { plan: { monthly_microusd: 200_000_000 }, month_spend_microusd: 135_610_000 };
  assert.deepEqual(allowanceView(me, NOW), { kind: 'plan', left: '$64.39', of: '$200.00', resets: '1 Nov', usedPct: 68 });
  assert.equal(allowanceView({ ...me, month_spend_microusd: 250_000_000 }, NOW).left, '$0.00', 'never below zero');
  assert.deepEqual(allowanceView({ plan: null, month_spend_microusd: 0 }, NOW), { kind: 'none', text: NO_PLAN });
  assert.deepEqual(allowanceView({ plan: { monthly_microusd: 0 }, month_spend_microusd: 0 }, NOW), { kind: 'none', text: NO_PLAN });
  assert.equal(NO_PLAN, 'No plan: top up as you go.');
  assert.equal(allowanceView({ plan: { monthly_microusd: 1 } }, NOW), null, 'a spend it did not send is not guessed');
});

test('Buy tokens: each pack to the existing checkout, an offer only while the Worker sends one live, first purchase only', () => {
  const cards = packCards({ packs: [
    { uid: 'pack25', price_id: 'price_25', unit_amount: 2500, credit_microusd: 25_000_000, bonus_microusd: 2_500_000, offer_ends_at: '2026-11-12T09:00:00.000Z', first_purchase_only: false },
    { uid: 'pack10', price_id: 'price_10', unit_amount: 1000, credit_microusd: 10_000_000, bonus_microusd: 0, offer_ends_at: null, first_purchase_only: true },
    { uid: null, price_id: 'price_env', unit_amount: 1500, credit_microusd: 15_000_000, bonus_microusd: 1_000_000 },
  ] });
  assert.deepEqual(cards, [
    { key: 'pack25', amount: '$25', offer: '+10% bonus, ends 12 Nov', firstOnly: false, href: '/checkout?token_pack=pack25' },
    { key: 'pack10', amount: '$10', offer: null, firstOnly: true, href: '/checkout?token_pack=pack10' },
    { key: 'price_env', amount: '$15', offer: '+6.7% bonus', firstOnly: false, href: '/checkout?token_pack=price_env' },
  ]);
  assert.deepEqual(packCards({ packs: [{ uid: 'x', unit_amount: 0 }] }), [], 'a pack with no price is not offered');
  assert.deepEqual(packCards(null), []);
});

test('Payment details: the default card, its brand, last four and expiry; none on file', () => {
  const overview = { payment_methods: [
    { brand: 'mastercard', last4: '5555', exp_month: 1, exp_year: 2030, is_default: false },
    { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028, is_default: true },
  ] };
  assert.deepEqual(paymentCard(overview), { brand: 'Visa', last4: '4242', expires: '08/28' });
  assert.deepEqual(paymentCard({ payment_methods: [{ brand: 'mastercard', last4: '5555', exp_month: 1, exp_year: 2030 }] }), { brand: 'Mastercard', last4: '5555', expires: '01/30' }, 'no default: the first');
  assert.equal(paymentCard({ payment_methods: [] }), null);
  assert.equal(paymentCard({ payment_methods: [{ brand: 'visa', last4: '••••' }] }), null, 'no last four is no card');
});

test('auto-reload: the spend-limit line, and Paused while this month\'s limit is reached', () => {
  assert.deepEqual(limitLine({ limit_microusd: 500_000_000, resets_on: '2026-11-01' }), { text: 'Stops at your monthly spend limit of $500.00.', link: true });
  assert.deepEqual(limitLine({ limit_microusd: null }), { text: 'No spend limit: reloads continue each time your balance runs low.', link: false });
  assert.equal(limitLine(null), null);
  assert.equal(pausedLine({ enabled: true, last_outcome: 'spend_limit' }, { resets_on: '2026-11-01' }), 'Paused: this month\'s spend limit is reached. Resumes 1 Nov.');
  assert.equal(pausedLine({ enabled: true, last_outcome: 'token_balance_ceiling' }, {}), null);
  assert.equal(pausedLine({ enabled: false, last_outcome: 'spend_limit' }, {}), null, 'off is not paused');
});

// ------------------------------------------------------------------ the cards

test('Token balance: loading, unreadable (never a zero), and the balance with Buy tokens', async () => {
  let m = await mount(h(TokenBalanceCard, { me: LOADING }));
  try { assert.equal(m.byTestId('value-token-balance'), undefined); } finally { await m.unmount(); }
  m = await mount(h(TokenBalanceCard, { me: UNREADABLE }));
  try { assert.match(m.text(), /This is not a claim that it is zero\./); } finally { await m.unmount(); }
  m = await mount(h(TokenBalanceCard, { me: ready({ balance_microusd: 27_500_000 }) }));
  try {
    assert.equal(m.textOf('value-token-balance'), '$27.50 AI tokens');
    assert.equal(m.props(m.byTestId('link-buy-tokens')).href, '#buy-tokens');
    assert.doesNotMatch(m.text(), /credit/i, 'AI tokens are never credits (D793)');
  } finally { await m.unmount(); }
});

test('Included with your plan: the allowance left and its reset, or no plan', async () => {
  let m = await mount(h(PlanAllowanceCard, { me: ready({ plan: { monthly_microusd: 200_000_000 }, month_spend_microusd: 135_610_000 }), now: NOW }));
  try {
    assert.equal(m.textOf('value-plan-allowance'), '$64.39 of $200.00 left this month, resets 1 Nov');
    assert.equal(m.props(m.byTestId('bar-plan-allowance')).style.width, '68%');
  } finally { await m.unmount(); }
  m = await mount(h(PlanAllowanceCard, { me: ready({ plan: null, month_spend_microusd: 0 }), now: NOW }));
  try { assert.equal(m.textOf('value-plan-allowance'), 'No plan: top up as you go.'); } finally { await m.unmount(); }
});

test('Buy tokens: the pack cards, the offer and first-purchase pills only where sent, Buy to checkout, the footnote', async () => {
  const topUp = ready({ packs: [
    { uid: 'pack25', price_id: 'price_25', unit_amount: 2500, credit_microusd: 25_000_000, bonus_microusd: 2_500_000, offer_ends_at: '2026-11-12T09:00:00.000Z' },
    { uid: 'pack10', price_id: 'price_10', unit_amount: 1000, credit_microusd: 10_000_000, bonus_microusd: 0, first_purchase_only: true },
  ] });
  let m = await mount(h(BuyTokensCard, { topUp }));
  try {
    assert.equal(m.textOf('pack-offer-pack25'), '+10% bonus, ends 12 Nov');
    assert.equal(m.byTestId('pack-offer-pack10'), undefined, 'no live offer, no pill');
    assert.equal(m.textOf('pack-first-pack10'), 'First purchase only');
    assert.equal(m.byTestId('pack-first-pack25'), undefined);
    assert.equal(m.props(m.byTestId('pack-buy-pack25')).href, '/checkout?token_pack=pack25');
    assert.ok(m.text().includes(TOKENS_FOOTNOTE), 'the footnote under the packs');
  } finally { await m.unmount(); }
  m = await mount(h(BuyTokensCard, { topUp: ready({ packs: [] }) }));
  try { assert.equal(m.textOf('buy-tokens-none'), 'Top-up isn\'t available yet.'); } finally { await m.unmount(); }
  m = await mount(h(BuyTokensCard, { topUp: UNREADABLE }));
  try { assert.match(m.text(), /This is not a claim that none is on sale\./); } finally { await m.unmount(); }
});

test('Payment details: the card, none on file, Stripe unreadable, and Manage in Stripe opens the portal', async () => {
  const opened = [];
  const overview = ready({ has_customer: true, payment_methods: [{ brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028, is_default: true }] });
  let m = await mount(h(PaymentDetailsCard, { role: 'founder', overview, openPortal: async () => ({ url: 'https://billing.stripe.example/session' }), navigate: (u) => opened.push(u) }));
  try {
    assert.equal(m.textOf('value-payment-card'), 'Visa •••• 4242 · expires 08/28');
    await m.click('button-manage-card');
    assert.deepEqual(opened, ['https://billing.stripe.example/session']);
  } finally { await m.unmount(); }
  m = await mount(h(PaymentDetailsCard, { role: 'founder', overview: ready({ has_customer: false, payment_methods: [] }) }));
  try {
    assert.equal(m.textOf('value-payment-card'), NO_CARD);
    assert.equal(m.props(m.byTestId('button-manage-card')).disabled, true, 'no billing account, no portal');
  } finally { await m.unmount(); }
  m = await mount(h(PaymentDetailsCard, { role: 'founder', overview: UNREADABLE }));
  try { assert.match(m.text(), /Billing could not be read from Stripe\./); } finally { await m.unmount(); }
});

test('Auto-reload: the limit line with Open limits, and the Paused state in place of On', async () => {
  const settings = { enabled: true, pack_uid: 'pack25', threshold_usd: 5, card: { brand: 'visa', last4: '4242' }, last_outcome: 'spend_limit', disabled_reason: null };
  const packs = [{ uid: 'pack25', label: '$25 of tokens' }];
  const m = await mount(h(AutoReloadForm, { settings, packs, limit: { limit_microusd: 500_000_000, resets_on: '2026-11-01' }, api: {} }));
  try {
    assert.equal(m.textOf('auto-reload-state'), 'Paused Paused: this month\'s spend limit is reached. Resumes 1 Nov.');
    assert.equal(m.byTestId('auto-reload-skipped'), undefined, 'the paused line replaces the skipped one');
    assert.equal(m.textOf('auto-reload-limit'), 'Stops at your monthly spend limit of $500.00. Open limits');
    assert.equal(m.props(m.byTestId('link-open-limits')).href, '/account/usage/limits');
  } finally { await m.unmount(); }
  const off = await mount(h(AutoReloadForm, { settings: { ...settings, last_outcome: null }, packs, limit: { limit_microusd: null }, api: {} }));
  try {
    assert.match(off.textOf('auto-reload-state'), /^On /);
    assert.equal(off.textOf('auto-reload-limit'), 'No spend limit: reloads continue each time your balance runs low.');
    assert.equal(off.byTestId('link-open-limits'), undefined);
  } finally { await off.unmount(); }
});

// ------------------------------------------------------------------ the page

test('the page lays the cards out in the canvas\'s order, and stacks them on a phone', () => {
  const page = readFileSync(new URL('../src/pages/SettingsPage.jsx', import.meta.url), 'utf8');
  const start = page.indexOf('function BillingConsole(');
  const src = page.slice(start, page.indexOf('\n}\n', start));
  const order = ['<TokenBalanceCard', '<PlanAllowanceCard', '<BuyTokensCard', '<PlanHeader', '<PaymentDetailsCard', '<AutoReloadCard', '<Orders'];
  const at = order.map((tag) => src.indexOf(tag));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the canvas\'s order');
  // Phone: one column; two from md (the canvas's 2-up rows), and the pack grid two-up on a phone, four from sm.
  assert.match(src, /<div className="grid gap-3 md:grid-cols-2">\n\s*<TokenBalanceCard/);
  assert.match(src, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.3fr\)\]/);
  const cards = readFileSync(new URL('../src/pages/account/BillingCards.jsx', import.meta.url), 'utf8');
  assert.match(cards, /grid grid-cols-2 gap-2\.5 sm:grid-cols-4/);
  assert.match(page, /<BillingConsole role=\{role\} billing=\{billing\} \/>\n\s*\{panel\}/, 'the role\'s panel follows');
});
