/**
 * D755 §4 and §14 (#1986, CR8) — HQ › AI allowances: one line per token pack,
 * New pack, Adopt, On sale, Bonus and Archive; one member's AI account with
 * Adjust balance; Reconcile, which never credits. Fixture people are
 * synthetic (@example.test).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_token_packs_d755.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { AdjustForm, MemberAccount, MemberAccountCard, NewPackForm, PackControls, ReconcileCard, TokenPacksCard } from '../src/pages/hq/TokenPacks.jsx';
import {
  CREDIT_RULES_LINE, NO_PACK_ON_SALE, PACK_REASON_LINES, REASON_MIN, TOPUP_REASON_LINES, bonusPercentOf, bonusUsd, exactEmailMatch, faceCentsOf,
  memberQuery, packLine, packLines, parseAdjustment, parseBonusPercent, parsePackAmount, reasonOk,
} from '../src/pages/hq/tokenPacksModel.js';

const h = React.createElement;

async function mount(element) {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(container);
  const byTestId = (id) => all().find((n) => props(n)['data-testid'] === id);
  const allByTestId = (id) => all().filter((n) => props(n)['data-testid'] === id);
  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    textOf: (id) => textOf(byTestId(id)).replace(/\s+/g, ' ').trim(),
    byTestId, allByTestId, props, flush,
    buttons: () => all().filter((n) => n.tagName === 'BUTTON' || n.nodeName === 'BUTTON' || n.localName === 'button').map((n) => textOf(n).replace(/\s+/g, ' ').trim()),
    disabled: (id) => props(byTestId(id)).disabled === true,
    async click(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ stopPropagation() {}, preventDefault() {} }); }); await flush(); },
    async submit(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onSubmit?.({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

const PACK = (over = {}) => ({ uid: 'pk1', origin: 'created', label: '$25 of tokens', state: 'ready', reason: null, price_id_suffix: 'abc123',
  on_sale: true, bonus_microusd: 0, sort: 0, adoptable: false, ...over });
const ready = (data) => ({ status: 'ready', data, reload: () => {} });

// ------------------------------------------------------------------ one line per pack

test('one line per pack, in each state, naming the pack instead of STRIPE_PRICE_AI_TOPUP', () => {
  assert.equal(packLine(PACK(), 'live').text, '$25 of tokens is on sale (price …abc123), live mode. Members see Add tokens.');
  assert.equal(packLine(PACK(), 'anything').text, '$25 of tokens is on sale (price …abc123), test mode. Members see Add tokens.', 'a mode it does not know is test');
  for (const reason of Object.keys(PACK_REASON_LINES)) {
    const line = packLine(PACK({ state: 'not_ready', reason }), 'live');
    assert.equal(line.tone, 'warning', reason);
    assert.match(line.text, /^\$25 of tokens \(price …abc123\): /, reason);
    assert.match(line.text, / Members don't see it\.$/, reason);
    assert.doesNotMatch(line.text, /STRIPE_PRICE_AI_TOPUP/, reason);
  }
  assert.equal(packLine(PACK({ state: 'not_ready', reason: 'off_sale' }), 'live').text, "$25 of tokens (price …abc123): off sale. Members don't see it.");
  assert.equal(packLine(PACK({ state: 'not_ready', reason: 'invented' }), 'live'), null, 'an unknown reason is not guessed');
  assert.equal(packLine(PACK({ label: null }), 'live'), null, 'a pack row with no label is not guessed');
  // The fallback says where it comes from, and only it offers Adopt.
  const fb = packLine({ origin: 'environment', uid: null, label: '$10 of tokens', state: 'ready', reason: null, price_id_suffix: 'zz9999', adoptable: true }, 'test');
  assert.equal(fb.text, 'From STRIPE_PRICE_AI_TOPUP: $10 of tokens is on sale (price …zz9999), test mode. Members see Add tokens.');
  assert.equal(fb.adoptable, true);
  assert.equal(packLine(PACK({ adoptable: true }), 'live').adoptable, false, 'a pack row is never "adoptable"');
  for (const reason of Object.keys(TOPUP_REASON_LINES)) assert.match(packLine({ origin: 'environment', state: 'not_ready', reason, adoptable: true }, 'live').text, /^From STRIPE_PRICE_AI_TOPUP: /);
  // The card's empty sentence: no pack on sale.
  assert.equal(packLines({ mode: 'live', packs: [] }).empty, NO_PACK_ON_SALE);
  assert.equal(NO_PACK_ON_SALE, "No token pack is on sale, so members are told the top-up isn't available yet.");
  assert.equal(packLines({ mode: 'live', packs: [PACK({ state: 'not_ready', reason: 'off_sale' })] }).empty, NO_PACK_ON_SALE);
  assert.equal(packLines({ mode: 'live', packs: [PACK()] }).empty, null);
  assert.equal(packLines({ mode: 'live', packs: [PACK(), PACK({ state: 'not_ready', reason: 'invented' })] }), null, 'one unknown line makes the card Unreadable, never partial');
  assert.equal(packLines({ state: 'ready' }), null, 'the deprecated single-price read alone is not a pack list');
});

test('the card draws a line per pack, controls on pack rows, Adopt on the fallback, and Unreadable on a failed read', async () => {
  const m = await mount(h(TokenPacksCard, { status: ready({ mode: 'live', packs: [PACK(), PACK({ uid: 'pk2', label: '$50 of tokens', state: 'not_ready', reason: 'off_sale', on_sale: false }),
    { origin: 'environment', uid: null, label: null, state: 'not_ready', reason: 'inactive', price_id_suffix: 'ff0000', adoptable: true }] }) }));
  try {
    assert.equal(m.allByTestId('hq-pack-line').length, 3);
    assert.ok(m.byTestId('hq-pack-controls-pk1'));
    assert.ok(m.byTestId('hq-pack-controls-pk2'));
    assert.ok(m.byTestId('hq-pack-fallback-adopt'));
    assert.equal(m.byTestId('hq-packs-none'), undefined, 'a pack is on sale');
    await m.click('hq-pack-fallback-adopt');
    assert.match(m.text(), /ending …ff0000/);
  } finally { await m.unmount(); }
  const u = await mount(h(TokenPacksCard, { status: { status: 'unreadable', data: null, reload: () => {} } }));
  try { assert.match(u.text(), /The token packs could not be read\. No pack has changed\./); } finally { await u.unmount(); }
});

// ------------------------------------------------------------------ New pack

test('New pack: whole dollars from $5 to $500, a preview, the Stripe-mode confirm, and one idempotency key per form', async () => {
  for (const [t, v] of [['4', null], ['5', 5], ['$25', 25], ['500', 500], ['501', null], ['25.50', null], ['-5', null], ['', null], ['5e2', null]]) assert.equal(parsePackAmount(t), v, t);
  const calls = [];
  const api = { create: async (usd, key) => { calls.push([usd, key]); if (calls.length === 1) throw new Error('The token pack could not be created in Stripe. Pressing Create again with the same key is safe.'); return { pack: { label: `$${usd} of tokens` } }; } };
  const done = [];
  const m = await mount(h(NewPackForm, { mode: 'live', api, onDone: (s) => done.push(s), onCancel: () => {} }));
  try {
    await m.type('hq-pack-new-amount', '4');
    assert.ok(m.byTestId('hq-pack-new-invalid'));
    assert.equal(m.disabled('hq-pack-new-next'), true, '$4 is refused');
    await m.type('hq-pack-new-amount', '501');
    assert.equal(m.disabled('hq-pack-new-next'), true, '$501 is refused');
    await m.type('hq-pack-new-amount', '25');
    assert.match(m.textOf('hq-pack-new-preview'), /^Members see it as “\s*\$25 of tokens\s*”\.$/);
    await m.click('hq-pack-new-next');
    assert.equal(calls.length, 0, 'Continue only asks');
    assert.equal(m.textOf('hq-pack-new-confirm'), "This creates a product and a one-time price in Stripe's live mode.");
    await m.click('hq-pack-new-create');
    assert.equal(m.textOf('hq-pack-new-error'), 'The token pack could not be created in Stripe. Pressing Create again with the same key is safe.');
    await m.click('hq-pack-new-create');
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 25);
    assert.equal(calls[0][1], calls[1][1], 'a retry from the same form sends the same key');
    assert.match(calls[0][1], /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual(done, ['$25 of tokens was created, off sale. Put it on sale when it should be offered.']);
  } finally { await m.unmount(); }
  const again = await mount(h(NewPackForm, { mode: 'test', api: { create: async (usd, key) => { calls.push([usd, key]); return {}; } }, onDone: () => {}, onCancel: () => {} }));
  try {
    await again.type('hq-pack-new-amount', '5');
    await again.click('hq-pack-new-next');
    assert.match(again.textOf('hq-pack-new-confirm'), /Stripe's test mode/);
    await again.click('hq-pack-new-create');
    assert.notEqual(calls[2][1], calls[0][1], 'a new form gets a fresh key');
  } finally { await again.unmount(); }
});

// ------------------------------------------------------------------ Bonus, On sale, Archive

test('the Bonus bound is 0 to 10% of the face, sent as US dollars; On sale toggles; Archive asks first', async () => {
  for (const [t, v] of [['0', 0], ['10', 10], ['10.01', null], ['2.5', 2.5], ['2.5%', 2.5], ['-1', null], ['11', null], ['', null], ['1.234', null]]) assert.equal(parseBonusPercent(t), v, t);
  assert.equal(faceCentsOf('$25 of tokens'), 2500);
  assert.equal(faceCentsOf('$7.50 of tokens'), 750);
  assert.equal(faceCentsOf('tokens'), null);
  assert.equal(bonusUsd(2500, 10), 2.5);
  assert.equal(bonusUsd(50000, 10), 50);
  assert.equal(bonusUsd(2500, 2.5), 0.625, 'kept to the micro-dollar the Worker stores');
  assert.equal(bonusPercentOf(2500, 2_500_000), 10);
  assert.equal(bonusPercentOf(2500, 0), 0);
  const calls = [];
  const api = { update: async (...a) => { calls.push(['update', ...a]); }, archive: async (...a) => { calls.push(['archive', ...a]); } };
  const done = [];
  const pack = PACK({ bonus_microusd: 1_250_000 });
  const m = await mount(h(PackControls, { pack, line: packLine(pack, 'live'), api, onDone: (s) => done.push(s) }));
  try {
    await m.click('hq-pack-bonus-open-pk1');
    assert.equal(m.props(m.byTestId('hq-pack-bonus-input-pk1')).value, '5', 'the field starts from the pack’s own bonus');
    assert.match(m.text(), /A bonus is a cost while AI is billed at cost\./);
    await m.type('hq-pack-bonus-input-pk1', '10.5');
    assert.ok(m.byTestId('hq-pack-bonus-invalid-pk1'));
    assert.equal(m.disabled('hq-pack-bonus-save-pk1'), true);
    await m.type('hq-pack-bonus-input-pk1', '10');
    await m.click('hq-pack-bonus-save-pk1');
    assert.deepEqual(calls.at(-1), ['update', 'pk1', { bonus_usd: 2.5 }]);
    await m.click('hq-pack-sale-pk1');
    assert.deepEqual(calls.at(-1), ['update', 'pk1', { on_sale: false }]);
    const before = calls.length;
    await m.click('hq-pack-archive-open-pk1');
    assert.equal(calls.length, before, 'Archive only asks first');
    assert.match(m.textOf('hq-pack-archive-confirm-pk1'), /^Archive \$25 of tokens\s*\? It goes off sale for good/);
    await m.click('hq-pack-archive-submit-pk1');
    assert.deepEqual(calls.at(-1), ['archive', 'pk1']);
    assert.deepEqual(done, ["$25 of tokens's bonus is 10%.", '$25 of tokens is off sale.', '$25 of tokens is archived.']);
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ one member's AI account

const ACCOUNT = {
  member_id: 42,
  allowance: { licence_key: 'founder:growth', source: 'recorded', daily_microusd: 5_000_000, monthly_microusd: 50_000_000 },
  balance_microusd: 12_000_000, topup_held_microusd: 1_000_000, ledger_balance_microusd: 12_000_000, on_hold: false,
  ledger: { items: [
    { uid: 'l1', kind: 'purchase', delta_microusd: 25_000_000, at: '2026-10-01 09:00:00', pack_label: '$25 of tokens' },
    { uid: 'l2', kind: 'adjustment', delta_microusd: -3_000_000, at: '2026-10-02 09:00:00', reason: 'Refund of a failed run', actor: '1' },
  ], next_before: '2026-10-01 09:00:00|l1' },
  purchases: [{ payment_intent_id: 'pi_1', order_ref: 'o1', pack_label: '$25 of tokens', state: 'credited', amount_microusd: 25_000_000, at: '2026-10-01 09:00:00' }],
  shortfalls: [],
};

test('the lookup takes an email or an ID; an email resolves to exactly one account', () => {
  assert.deepEqual(memberQuery('42'), { id: 42 });
  assert.deepEqual(memberQuery(' Ana@Example.test '), { email: 'ana@example.test' });
  for (const t of ['', '0', 'ana', 'a@b', '42 43', '-1']) assert.equal(memberQuery(t), null, t);
  const rows = [{ id: 7, email: 'ana@example.test' }, { id: 8, email: 'ana@example.test.other' }];
  assert.equal(exactEmailMatch(rows, 'ana@example.test'), 7);
  assert.equal(exactEmailMatch(rows, 'bo@example.test'), null);
  assert.equal(exactEmailMatch([...rows, { id: 9, email: 'ANA@example.test' }], 'ana@example.test'), null, 'two accounts answering one email is not a match');
});

test('the member lookup draws each section, and a part that is not there blanks only its own section', async () => {
  const m = await mount(h(MemberAccount, { account: ACCOUNT, memberId: 42, api: {}, onAdjusted: () => {} }));
  try {
    assert.match(m.textOf('hq-member-allowance'), /\$5\.00 a day · \$50\.00 a month · Set by HQ · founder:growth/);
    assert.match(m.textOf('hq-member-balance'), /Balance \$12\.00 · held \$1\.00 · ledger \$12\.00/);
    assert.equal(m.allByTestId('hq-member-ledger-row').length, 2);
    assert.match(m.textOf('hq-member-ledger'), /Adjustment −\$3\.00 Refund of a failed run/);
    assert.match(m.textOf('hq-member-purchases'), /\$25 of tokens · Added/);
    assert.match(m.textOf('hq-member-shortfalls'), /No shortfall is recorded\./);
    assert.ok(m.byTestId('hq-member-adjust'));
  } finally { await m.unmount(); }
  const broken = await mount(h(MemberAccount, { account: { ...ACCOUNT, purchases: 'nope', allowance: null }, memberId: 42, api: {}, onAdjusted: () => {} }));
  try {
    assert.match(broken.textOf('hq-member-purchases'), /The purchases could not be read/);
    assert.match(broken.textOf('hq-member-allowance'), /The allowance could not be read/);
    assert.match(broken.textOf('hq-member-balance'), /Balance \$12\.00/, 'the balance still draws');
    assert.equal(broken.allByTestId('hq-member-ledger-row').length, 2, 'the ledger still draws');
    assert.match(broken.textOf('hq-member-shortfalls'), /No shortfall is recorded/);
  } finally { await broken.unmount(); }
  // The next ledger page failing blanks the ledger only.
  const paged = await mount(h(MemberAccount, { account: ACCOUNT, memberId: 42, api: { member: async () => { throw new Error('down'); } }, onAdjusted: () => {} }));
  try {
    await paged.click('hq-member-ledger-more');
    assert.match(paged.textOf('hq-member-ledger'), /The ledger could not be read/);
    assert.match(paged.textOf('hq-member-purchases'), /Added/);
    assert.match(paged.textOf('hq-member-balance'), /Balance \$12\.00/);
  } finally { await paged.unmount(); }
});

test('looking up by email reads the one exact account; a Worker refusal is its own sentence', async () => {
  const asked = [];
  const users = { adminListUsers: async (o) => { asked.push(o); return [{ id: 42, email: 'ana@example.test' }, { id: 43, email: 'ana@example.test.co' }]; } };
  const packs = { member: async (id) => { asked.push(id); return ACCOUNT; } };
  const m = await mount(h(MemberAccountCard, { api: packs, users }));
  try {
    await m.type('hq-member-query', 'Ana@example.test');
    await m.submit('hq-member-lookup');
    assert.deepEqual(asked, [{ q: 'ana@example.test', limit: 20 }, 42]);
    assert.ok(m.byTestId('hq-member-account'));
  } finally { await m.unmount(); }
  const nf = await mount(h(MemberAccountCard, { api: { member: async () => { throw new Error('No member has that ID.'); } }, users }));
  try {
    await nf.type('hq-member-query', '999');
    await nf.submit('hq-member-lookup');
    assert.equal(nf.textOf('hq-member-error'), 'No member has that ID.');
    assert.equal(nf.byTestId('hq-member-account'), undefined);
    await nf.type('hq-member-query', 'bo@example.test');
    await nf.submit('hq-member-lookup');
    assert.equal(nf.textOf('hq-member-error'), 'No member has exactly that email.');
  } finally { await nf.unmount(); }
});

// ------------------------------------------------------------------ Adjust balance

test('Adjust refuses a 9-character reason and a value outside the bounds, and sends one write', async () => {
  assert.equal(REASON_MIN, 10);
  assert.equal(reasonOk('123456789'), false);
  assert.equal(reasonOk(' 1234567890 '), true);
  assert.equal(reasonOk('x'.repeat(501)), false);
  for (const [t, v] of [['+10', 10], ['-5', -5], ['100', 100], ['-100', -100], ['100.01', null], ['-100.5', null], ['0', null], ['+$12.50', 12.5], ['1.234', null], ['abc', null]]) assert.equal(parseAdjustment(t), v, t);
  let release;
  const calls = [];
  const api = { adjust: (...a) => { calls.push(a); return new Promise((r) => { release = () => r({ uid: 'a1', already_recorded: false }); }); } };
  const done = [];
  const m = await mount(h(AdjustForm, { memberId: 42, api, onDone: (s) => done.push(s) }));
  try {
    await m.type('hq-member-adjust-amount', '+10');
    await m.type('hq-member-adjust-reason', '123456789');
    assert.equal(m.disabled('hq-member-adjust-submit'), true, 'a 9-character reason is refused');
    await m.type('hq-member-adjust-reason', 'Goodwill credit after outage');
    await m.type('hq-member-adjust-amount', '150');
    assert.ok(m.byTestId('hq-member-adjust-invalid'));
    assert.equal(m.disabled('hq-member-adjust-submit'), true, '$150 is outside the bounds');
    await m.type('hq-member-adjust-amount', '-7.25');
    assert.equal(m.disabled('hq-member-adjust-submit'), false);
    // The write is held open, so the presses are fired, not awaited.
    let first;
    await act(async () => { first = m.props(m.byTestId('hq-member-adjust')).onSubmit({ preventDefault() {} }); });
    await act(async () => { m.props(m.byTestId('hq-member-adjust')).onSubmit({ preventDefault() {} }); });
    assert.equal(calls.length, 1, 'a second press while the first is in flight sends nothing');
    await act(async () => { release(); await first; });
    await m.flush();
    assert.equal(calls[0][0], 42);
    assert.equal(calls[0][1], -7.25);
    assert.equal(calls[0][2], 'Goodwill credit after outage');
    assert.match(calls[0][3], /^[A-Za-z0-9_-]{8,64}$/);
    assert.deepEqual(done, ['Took off $7.25.']);
    assert.match(m.text(), /The member is told the amount, never the reason\./);
  } finally { await m.unmount(); }
  const refused = await mount(h(AdjustForm, { memberId: 42, api: { adjust: async () => { throw new Error('At most $250 is added by adjustments to one member in 30 days.'); } }, onDone: () => {} }));
  try {
    await refused.type('hq-member-adjust-amount', '50');
    await refused.type('hq-member-adjust-reason', 'Goodwill credit after outage');
    await refused.submit('hq-member-adjust');
    assert.equal(refused.textOf('hq-member-adjust-error'), 'At most $250 is added by adjustments to one member in 30 days.');
  } finally { await refused.unmount(); }
});

// ------------------------------------------------------------------ Reconcile

test('Reconcile lists the three, says how to resend, and offers no credit button', async () => {
  const data = {
    mismatched: [{ member_id: 42, balance_microusd: 5_000_000, ledger_microusd: 4_000_000, difference_microusd: 1_000_000 }],
    overdue: [{ member_id: 43, payment_intent_id: 'pi_9', pack_label: '$25 of tokens', amount_microusd: 25_000_000, at: '2026-10-18 09:00:00', instruction: 'Resend payment_intent.succeeded from Stripe › Developers › Events' }],
    open_disputes: [{ member_id: 44, payment_intent_id: 'pi_8', pack_label: '$50 of tokens', amount_microusd: 50_000_000, at: '2026-10-17 09:00:00' }],
  };
  const m = await mount(h(ReconcileCard, { reconcile: ready(data) }));
  try {
    assert.match(m.textOf('hq-reconcile-mismatched'), /Member 42 · balance \$5\.00 · ledger \$4\.00 · \+\$1\.00/);
    assert.match(m.textOf('hq-reconcile-overdue'), /Member 43 · \$25 of tokens · \$25\.00 .* Resend payment_intent\.succeeded from Stripe › Developers › Events\s*\./);
    assert.match(m.textOf('hq-reconcile-disputes'), /Member 44 · \$50 of tokens · \$50\.00/);
    for (const b of m.buttons()) assert.doesNotMatch(b, /credit/i, `no credit button: ${b}`);
  } finally { await m.unmount(); }
  const part = await mount(h(ReconcileCard, { reconcile: ready({ ...data, overdue: null }) }));
  try {
    assert.match(part.textOf('hq-reconcile-overdue'), /The overdue purchases could not be read/);
    assert.match(part.textOf('hq-reconcile-mismatched'), /Member 42/, 'the other lists still draw');
  } finally { await part.unmount(); }
  const none = await mount(h(ReconcileCard, { reconcile: { status: 'unreadable', data: null, reload: () => {} } }));
  try { assert.match(none.text(), /This is not a claim that nothing needs reconciling\./); } finally { await none.unmount(); }
});

// ------------------------------------------------------------------ the pages

test('the page mounts the three cards in place of D750’s line, and Credit rules says where AI tokens are', () => {
  const page = readFileSync('frontend/src/pages/hq/PlatformAllowancesPage.jsx', 'utf8');
  assert.match(page, /<TokenPacksCard status=\{packs\}/);
  assert.match(page, /<MemberAccountCard \/>/);
  assert.match(page, /<ReconcileCard reconcile=\{reconcile\} \/>/);
  assert.doesNotMatch(page, /TopUpReadinessCard/);
  assert.match(page, /tokenPacksApi\.status\(\)/);
  assert.match(page, /tokenPacksApi\.reconcile\(\)/);
  assert.equal(CREDIT_RULES_LINE, 'AI tokens are not perk credits. They are on AI allowances › Token packs.');
  const rules = readFileSync('frontend/src/pages/hq/CreditRulesRegistryPage.jsx', 'utf8');
  assert.match(rules, /\{CREDIT_RULES_LINE\}/);
  assert.match(rules, /<Link to="\/admin\/platform\/allowances"/);
  // HQ never credits: nothing on these screens calls a credit route.
  const packs = readFileSync('frontend/src/pages/hq/TokenPacks.jsx', 'utf8');
  assert.doesNotMatch(packs, /\.credit\(|\/credit\b|credit_purchase/);
});
