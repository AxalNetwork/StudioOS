/**
 * D1287 (#3370, part 2 of #2452) — the checkout sheet's pack mode, "Add
 * tokens" (CRP2–CRP5, CRP7, CRP8, CRP15, CRP17). Every read is answered by a
 * fixture through the sheet's `reads`, and Stripe through its `bridge`: no
 * network, no Stripe, fake figures only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/checkout_pack_mode_d1287.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PackSheet from '../src/components/checkout/PackSheet.jsx';
import {
  PACK_PROMO, PACK_RULES, autoReloadView, backLabel, balanceLine, countFrames, intentBody, keepsReading, landingView, packRows, packRule,
  packTotals, startingPack, customOffer, customPack, customRangeLine, CUSTOM_KEY,
} from '../src/components/checkout/packModel.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-27T12:00:00Z');
const TOP_UP = {
  state: 'ready',
  on_hold: false,
  latest: null,
  packs: [
    { uid: 'k10', price_id: 'price_k10', unit_amount: 1000, currency: 'usd', credit_microusd: 10_000_000, bonus_microusd: 0, first_purchase_only: true },
    { uid: 'k25', price_id: 'price_k25', unit_amount: 2500, currency: 'usd', credit_microusd: 25_000_000, bonus_microusd: 2_500_000, offer_ends_at: '2026-11-01T00:00:00Z' },
    { uid: 'bad', price_id: 'not-a-price', unit_amount: 500, currency: 'usd', credit_microusd: 5_000_000, bonus_microusd: 0 },
  ],
};
const ME = { balance_microusd: 3_400_000 };
const INTENT = { client_secret: 'pi_fixture_secret', order_ref: 'MRD-2026-FIXTURE', currency: 'usd', subtotal: 2500, vat_cents: 0, total: 2500, free: false };
const order = (state, extra = {}) => ({ order: { order_ref: 'MRD-2026-FIXTURE', ai_topup: { state, amount_microusd: 25_000_000, credit_microusd: 25_000_000, bonus_microusd: 2_500_000, balance_microusd: 30_900_000, at: '2026-10-27 11:59:00', ...extra } } });

// ───────────────────────────────────────────── the rules

test('pack rows: HQ’s order, offers on the pack, an unsellable line left out', () => {
  // Mutation checked: drop sellableLine → "bad" appears; reverse the order → k25 first.
  const rows = packRows(TOP_UP);
  assert.deepEqual(rows.map((r) => r.key), ['k10', 'k25']);
  assert.deepEqual(rows.map((r) => [r.label, r.price]), [['$10 of AI tokens', '$10.00'], ['$25 of AI tokens', '$25.00']]);
  assert.deepEqual(rows[0].offers, ['First purchase only']);
  assert.deepEqual(rows[1].offers, ['+10% bonus until 1 Nov']);
  assert.equal(startingPack(rows, 'k25'), 'k25');
  assert.equal(startingPack(rows, 'gone'), 'k10', 'a pack no longer on sale opens on the first');
  assert.equal(startingPack([], 'k25'), null);
});

test('the balance line and the totals come from the fixture; before Pay VAT is worked out at payment, never $0.00', () => {
  // Mutation checked: leave the bonus out of the after-figure → "$28.40"; draw VAT as $0.00 before the intent → the reason is gone.
  const [, k25] = packRows(TOP_UP);
  assert.equal(balanceLine(3_400_000, k25), 'Your balance: $3.40 → $30.90 once the payment is confirmed.');
  assert.match(balanceLine(null, k25), /^Your balance couldn’t be read just now\. This pack adds \$27\.50/);
  assert.deepEqual(packTotals(k25).map((t) => [t.key, t.value ?? t.reason]), [
    ['pack', '$25.00'], ['bonus', '+$2.50'], ['vat', 'Worked out when you pay'], ['due', '$25.00'],
  ]);
  assert.deepEqual(packTotals(k25, { ...INTENT, vat_cents: 125, total: 2625 }).slice(-2).map((t) => t.value), ['$1.25', '$26.25'], 'once the intent answers, its figures');
  assert.deepEqual(packTotals(null), []);
});

test('the intent is sent exactly one pack line', () => {
  // Mutation checked: send quantity 2, or two lines → the shape fails.
  const [k10] = packRows(TOP_UP);
  assert.deepEqual(intentBody(k10, 'n1'), { items: [{ price_id: 'price_k10', quantity: 1 }], nonce: 'n1' });
});

test('each pack rule code maps to its sentence; the Worker’s own sentence wins; anything else is not a pack rule', () => {
  // Mutation checked: read the code through the message → the table never answers; drop a code → its sentence is null.
  for (const [code, line] of Object.entries(PACK_RULES)) assert.deepEqual(packRule({ code, message: code }), { code, line }, code);
  assert.equal(PACK_RULES.promo_not_for_token_packs, PACK_PROMO);
  assert.equal(packRule({ code: 'token_pack_daily_limit', message: 'You’ve reached today’s limit of 5 pack orders. Try again tomorrow.' }).line,
    'You’ve reached today’s limit of 5 pack orders. Try again tomorrow.');
  assert.equal(packRule({ code: 'stripe_not_configured' }), null);
  assert.equal(packRule({}), null);
});

test('landing: Accepted only on credited; waiting is landing; overdue after an hour, with no retry', () => {
  // Mutation checked: treat waiting as credited → "Tokens added." before the webhook; drop the hour → overdue never comes.
  assert.equal(landingView(order('credited').order, NOW).key, 'credited');
  assert.equal(landingView(order('credited').order, NOW).title, 'Tokens added.');
  assert.equal(landingView(order('credited').order, NOW).bonus, '+$2.50 bonus added');
  const waiting = landingView(order('waiting', { at: '2026-10-27 11:30:00' }).order, NOW);
  assert.deepEqual([waiting.key, waiting.line], ['waiting', 'Adding $25.00 to your balance…']);
  const late = landingView(order('waiting', { at: '2026-10-27 10:30:00' }).order, NOW);
  assert.equal(late.key, 'overdue');
  assert.equal(late.title, 'Your tokens are on their way.');
  assert.equal(late.sub, 'You won’t be charged again for this order.');
  assert.ok(!/try again|retry/i.test(`${late.line} ${late.sub}`), 'no retry is offered');
  assert.equal(landingView(order('overdue').order, NOW).key, 'overdue');
  for (const o of [null, { order_ref: 'x' }, { ai_topup: { state: 'unreadable' } }]) assert.equal(landingView(o, NOW).key, 'unknown');
  assert.equal(keepsReading(landingView(order('credited').order, NOW)), false);
  assert.equal(keepsReading(landingView(order('waiting').order, NOW)), true);
  assert.equal(keepsReading(landingView(null, NOW)), true);
  assert.equal(NOW - HOUR, Date.parse('2026-10-27T11:00:00Z'));
});

test('the count-up ends on the new figure; reduced motion or no old figure shows the final value only', () => {
  // Mutation checked: ignore `still` → twenty frames under reduced motion; end one frame short → the last is not the balance.
  const frames = countFrames(3_400_000, 30_900_000, 20);
  assert.equal(frames.length, 20);
  assert.equal(frames[0] !== '$30.90', true);
  assert.equal(frames.at(-1), '$30.90');
  assert.deepEqual(countFrames(3_400_000, 30_900_000, 20, { still: true }), ['$30.90']);
  assert.deepEqual(countFrames(null, 30_900_000), ['$30.90']);
  assert.deepEqual(countFrames(3_400_000, null), []);
});

test('auto-reload: off, on, off after a decline, and a read that needs a fresh code says Billing; never set here', () => {
  // Mutation checked: read a declined row as plain off → the decline sentence is gone.
  const rows = packRows(TOP_UP);
  assert.equal(autoReloadView({ status: 'ready', data: { enabled: false } }, rows).key, 'off');
  const on = autoReloadView({ status: 'ready', data: { enabled: true, pack_uid: 'k25', threshold_usd: 5, card: { brand: 'visa', last4: '4242' } } }, rows);
  assert.equal(on.line, 'Auto-reload is on: $25.00 when your balance drops below $5. Card: Visa ending 4242.');
  assert.equal(on.link, 'Change on Billing ›');
  assert.equal(autoReloadView({ status: 'ready', data: { enabled: false, disabled_reason: 'card_declined' } }, rows).line, 'Auto-reload is off: your card was declined. Update it on Billing.');
  assert.equal(autoReloadView({ status: 'unreadable' }, rows).key, 'elsewhere');
  assert.equal(backLabel(), 'Back to Models');
  assert.equal(backLabel('Pitch deck'), 'Back to Pitch deck');
});

// ───────────────────────────────────────────── the sheet

function fakeBridge(log, { confirm = { error: null } } = {}) {
  function CardForm({ onReady, mode }) {
    React.useEffect(() => {
      log.push(['mode', mode]);
      onReady({
        submit: async () => { log.push(['submit']); return { error: null }; },
        confirm: async (secret) => { log.push(['confirm', secret]); return typeof confirm === 'function' ? confirm() : confirm; },
      });
    }, [onReady, mode]);
    return React.createElement('div', { 'data-testid': 'stub-card-form' });
  }
  return { CardForm };
}

async function mount(props, routes = {}) {
  const restore = installDocument();
  const calls = [];
  const answer = (k) => async (arg) => {
    calls.push([k, arg]);
    const r = routes[k];
    const v = typeof r === 'function' ? r(arg, calls) : r;
    if (v instanceof Error) throw v;
    return v;
  };
  const reads = Object.fromEntries(['topUp', 'mine', 'autoReload', 'history', 'intent', 'order'].map((k) => [k, answer(k)]));
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const p = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => p(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(PackSheet, { reads, pollMs: 1, ...props }))));
  await settle();
  return {
    calls, byId, settle, has: (id) => !!byId(id), text: (id) => text(byId(id)), props: (id) => p(byId(id)),
    async click(id) { const q = p(byId(id)); assert.ok(q.onClick, `no ${id}`); await act(async () => { await q.onClick({ preventDefault() {} }); }); await settle(); },
    async pick(id) { const q = p(byId(id)); await act(async () => { q.onChange({ target: { checked: true } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

const ROUTES = { topUp: TOP_UP, mine: ME, autoReload: { enabled: false }, history: { items: [], pending: [], next_before: null } };

test('CRP2: the sheet opens on the pack asked for, with the balance line, the totals, the promo line and auto-reload', async () => {
  const log = [];
  const v = await mount({ pack: 'k25', bridge: fakeBridge(log) }, ROUTES);
  try {
    assert.equal(v.props('pack-pick-k25').checked, true);
    assert.equal(v.text('pack-balance-line'), 'Your balance: $3.40 → $30.90 once the payment is confirmed.');
    assert.equal(v.text('pack-total-due'), 'Due today$25.00');
    assert.equal(v.text('pack-promo'), PACK_PROMO);
    assert.ok(v.has('pack-auto-reload-off'));
    assert.equal(v.text('pack-pay'), 'Pay $25.00');
    assert.deepEqual(log[0], ['mode', 'payment'], 'the card form takes a one-time payment');
    assert.equal(v.calls.filter(([k]) => k === 'intent').length, 0, 'nothing is created before Pay');
  } finally { await v.close(); }
});

test('Pay sends one pack line, confirms the order’s intent, and shows Tokens added only once the order is credited', async () => {
  // Mutation checked: draw Accepted on the intent's answer → "Tokens added." while the order still waits.
  const log = [];
  let reads = 0;
  const v = await mount({ pack: 'k25', bridge: fakeBridge(log) }, {
    ...ROUTES,
    intent: INTENT,
    order: () => (reads++ < 2 ? order('waiting', { at: '2099-01-01 00:00:00' }) : order('credited')),
  });
  // D1363: the page refused for tokens hears they landed once, at Tokens added, never while the order waits.
  const added = [];
  const keepDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { added.push(e.type); return true; };
  try {
    await v.click('pack-pay');
    const intents = v.calls.filter(([k]) => k === 'intent');
    assert.equal(intents.length, 1);
    assert.deepEqual(intents[0][1].items, [{ price_id: 'price_k25', quantity: 1 }]);
    assert.deepEqual(log.slice(1), [['submit'], ['confirm', 'pi_fixture_secret']]);
    for (let i = 0; i < 6 && !v.has('pack-accepted'); i += 1) await v.settle();
    assert.ok(v.has('pack-accepted'), 'Accepted once credited');
    assert.ok(v.calls.filter(([k]) => k === 'order').length >= 3, 'the order was read until credited');
    assert.equal(v.text('pack-bonus'), '+$2.50 bonus added');
    assert.match(v.text('pack-balance-final'), /Your token balance is \$30\.90\./, 'screen readers hear the final figure');
    assert.equal(v.text('pack-back'), 'Back to Models');
    assert.deepEqual(added, ['studioos:tokens_added'], 'said once, at Tokens added');
  } finally { globalThis.dispatchEvent = keepDispatch; await v.close(); }
});

test('the landing shows Payment received while the order waits, and never Tokens added', async () => {
  const v = await mount({ pack: 'k10', bridge: fakeBridge([]) }, { ...ROUTES, intent: INTENT, order: () => order('waiting', { at: '2099-01-01 00:00:00' }) });
  const added = [];
  const keepDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { added.push(e.type); return true; };
  try {
    await v.click('pack-pay');
    assert.ok(v.has('pack-landing'));
    assert.match(v.text('pack-landing'), /Payment received\.Adding \$25\.00 to your balance…/);
    assert.ok(!v.has('pack-accepted'));
    assert.deepEqual(added, [], 'D1363: a refused run is not continued before the tokens land');
  } finally { globalThis.dispatchEvent = keepDispatch; await v.close(); }
});

test('CRP5: a pack rule is drawn on the pack’s row with Pay disabled; a decline is D1053’s words', async () => {
  // Mutation checked: show the rule as a page alert with Pay still on → Pay is enabled.
  const refusal = Object.assign(new Error('token_pack_first_purchase_only'), { code: 'token_pack_first_purchase_only' });
  const v = await mount({ pack: 'k10', bridge: fakeBridge([]) }, { ...ROUTES, intent: refusal });
  try {
    await v.click('pack-pay');
    assert.equal(v.text('pack-rule-token_pack_first_purchase_only'), PACK_RULES.token_pack_first_purchase_only);
    assert.equal(v.props('pack-pay').disabled, true);
    assert.equal(v.text('pack-pay-blocked'), 'Choose another pack to continue.');
    await v.pick('pack-pick-k25');
    assert.equal(v.props('pack-pay').disabled, false, 'another pack can be paid');
  } finally { await v.close(); }
  const d = await mount({ pack: 'k25', bridge: fakeBridge([], { confirm: { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' } } }) }, { ...ROUTES, intent: INTENT });
  try {
    await d.click('pack-pay');
    assert.match(d.text('pack-decline-funds'), /You were not charged\./);
    assert.ok(!d.has('pack-landing'));
  } finally { await d.close(); }
});

test('a hold the read reports blocks Pay before anything is sent; packs that cannot be read say so', async () => {
  const v = await mount({ bridge: fakeBridge([]) }, { ...ROUTES, topUp: { ...TOP_UP, on_hold: true } });
  try {
    assert.ok(v.has('pack-rule-token_packs_on_hold'));
    assert.equal(v.props('pack-pay').disabled, true);
  } finally { await v.close(); }
  const u = await mount({ bridge: fakeBridge([]) }, { ...ROUTES, topUp: new Error('503') });
  try {
    assert.ok(u.has('pack-rows-unreadable'));
    assert.ok(!u.has('pack-pay') || u.props('pack-pay').disabled, 'nothing to pay for');
  } finally { await u.close(); }
});

test('CRP8: History reads the member’s top-ups, says No top-ups yet when empty, and Show AI runs reads again with runs', async () => {
  const v = await mount({ bridge: fakeBridge([]) }, ROUTES);
  try {
    await v.click('pack-tab-history');
    assert.match(v.text('pack-history-empty'), /^No top-ups yet\./);
    await v.pick('pack-history-runs');
    const hist = v.calls.filter(([k]) => k === 'history').map(([, a]) => a.runs);
    assert.deepEqual(hist, [false, true]);
  } finally { await v.close(); }
});

test('CRP15: Pay sits in a bar fixed at the bottom on a phone and in place from sm up; dark pairs every white', async () => {
  const v = await mount({ pack: 'k25', bridge: fakeBridge([]) }, ROUTES);
  try {
    const cls = v.props('pack-pay-bar').className;
    assert.ok(cls.includes('sticky') && cls.includes('bottom-0') && cls.includes('sm:static'), cls);
    assert.ok(cls.includes('bg-white') && cls.includes('dark:bg-gray-900'), cls);
    assert.ok(v.props('pack-sheet').className.includes('dark:bg-gray-900'));
  } finally { await v.close(); }
});

test('D1365: on a phone the sheet\'s bar stays in reach — sticky, clear of the status bar — and Close closes it with nothing on sale', async () => {
  // Mutation checked: drop `sticky` (or the top safe area) from SHEET_BAR → the bar scrolls away under the status bar.
  let closed = 0;
  const v = await mount({ onClose: () => { closed += 1; } }, { ...ROUTES, topUp: { ...TOP_UP, packs: [] } });
  try {
    assert.equal(v.text('pack-rows-none'), 'Top-up isn’t available yet.');
    const bar = v.props('pack-bar').className;
    assert.match(bar, /\bsticky top-0\b/);
    assert.match(bar, /pt-\[env\(safe-area-inset-top\)\]/);
    assert.match(bar, /\bbg-white\b.*\bdark:bg-gray-900\b/, 'opaque, so content scrolls under it unseen, in both themes');
    assert.match(v.props('pack-sheet').className, /pb-\[env\(safe-area-inset-bottom\)\]/, 'clear of the home indicator');
    await v.click('pack-close');
    assert.equal(closed, 1);
  } finally { await v.close(); }
});

test('D1365: on any screen, Cancel beside Pay and a press on the dimmed page close the sheet; a press inside it never does', async () => {
  // Mutation checked: close on any backdrop click → the press that started inside the sheet closes it.
  let closed = 0;
  const v = await mount({ pack: 'k25', bridge: fakeBridge([]), onClose: () => { closed += 1; } }, ROUTES);
  try {
    const backdrop = v.props('pack-backdrop');
    const self = {};
    const inner = {};
    await act(async () => { backdrop.onMouseDown({ target: inner, currentTarget: self }); backdrop.onClick({ target: self, currentTarget: self }); });
    assert.equal(closed, 0, 'a drag that began inside the sheet is not a close');
    await act(async () => { backdrop.onMouseDown({ target: self, currentTarget: self }); backdrop.onClick({ target: self, currentTarget: self }); });
    assert.equal(closed, 1, 'a press on the dimmed page closes it');
    assert.equal(v.text('pack-cancel'), 'Cancel');
    await v.click('pack-cancel');
    assert.equal(closed, 2);
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- D1366: the custom amount
const CUSTOM = { price_id: 'price_unit', unit_amount: 100, currency: 'usd', min_cents: 500, max_cents: 50_000 };

test('D1366: a custom amount is whole dollars from $5 to $500, quoted and paid as N of the $1 price', () => {
  // Mutation checked: drop the minimum check → "4" gives a pack.
  const offer = customOffer(CUSTOM);
  assert.deepEqual(offer, { priceId: 'price_unit', minDollars: 5, maxDollars: 500 });
  assert.equal(customRangeLine(offer), 'Any whole amount from $5 to $500.');
  for (const bad of [null, { ...CUSTOM, unit_amount: 200 }, { ...CUSTOM, price_id: 'nope' }, { ...CUSTOM, min_cents: 450 }]) assert.equal(customOffer(bad), null);
  assert.deepEqual(customPack(offer, ''), { pack: null, problem: null }, 'nothing typed, nothing said');
  assert.equal(customPack(offer, '4').problem, 'The minimum top-up is $5.');
  assert.equal(customPack(offer, '501').problem, 'The most one top-up can add is $500.');
  assert.equal(customPack(offer, '12.5').problem, 'Enter whole dollars, from $5 to $500.');
  const p = customPack(offer, '$25').pack;
  assert.deepEqual([p.key, p.quantity, p.cents, p.price, p.label, p.creditMicro, p.bonusMicro], [CUSTOM_KEY, 25, 2500, '$25.00', '$25 of AI tokens', 25_000_000, 0]);
  assert.deepEqual(intentBody(p, 'n1'), { items: [{ price_id: 'price_unit', quantity: 25 }], nonce: 'n1' });
  assert.deepEqual(intentBody(packRows(TOP_UP)[1], 'n2').items, [{ price_id: 'price_k25', quantity: 1 }], 'a pack is still one line of one');
  assert.equal(startingPack([], null, offer), CUSTOM_KEY, 'with no pack, the custom amount is chosen');
  assert.equal(startingPack(packRows(TOP_UP), null, offer), 'k10', 'with packs, the first pack');
});

test('D1366: the sheet offers the packs and a custom amount; a typed $37 pays $37 as 37 of the $1 price', async () => {
  const log = [];
  const v = await mount({ bridge: fakeBridge(log) }, { ...ROUTES, topUp: { ...TOP_UP, custom: CUSTOM }, intent: INTENT,
    order: () => order('waiting', { at: '2099-01-01 00:00:00' }) });
  try {
    assert.ok(v.has('pack-row-k25') && v.has('pack-row-custom'), 'packs and the custom amount, side by side');
    assert.equal(v.text('pack-custom-range'), 'Any whole amount from $5 to $500.');
    await act(async () => { v.props('pack-custom-amount').onChange({ target: { value: '3' } }); });
    await v.settle();
    assert.equal(v.props('pack-pick-custom').checked, true, 'typing an amount chooses it');
    assert.equal(v.text('pack-custom-problem'), 'The minimum top-up is $5.');
    assert.equal(v.props('pack-pay').disabled, true, 'nothing to pay below $5');
    await act(async () => { v.props('pack-custom-amount').onChange({ target: { value: '37' } }); });
    await v.settle();
    assert.ok(!v.has('pack-custom-problem'));
    assert.equal(v.text('pack-pay'), 'Pay $37.00');
    await v.click('pack-pay');
    const intents = v.calls.filter(([k]) => k === 'intent');
    assert.deepEqual(intents[0][1].items, [{ price_id: 'price_unit', quantity: 37 }]);
  } finally { await v.close(); }
});
