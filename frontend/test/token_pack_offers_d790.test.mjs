/**
 * D790 (#2215) — token pack offers in the frontend: HQ's Offer editor (the
 * bonus's window and first purchase only, refused before it asks when the end
 * does not follow the start), the pack row's offer line, and what a member is
 * told about a pack on sale (its bonus, when that bonus ends, first purchase
 * only) on the pack list and at checkout.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/token_pack_offers_d790.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PackControls } from '../src/pages/hq/TokenPacks.jsx';
import { offerInputOf, offerLine, packLine, parseOffer } from '../src/pages/hq/tokenPacksModel.js';
import { packOfferLines } from '../src/lib/aiTokens.js';
import { readFileSync } from 'node:fs';

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
  const byTestId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const need = (id) => { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    byTestId, props,
    all: (id) => walk(container).filter((n) => props(n)['data-testid'] === id).map((n) => textOf(n).replace(/\s+/g, ' ').trim()),
    disabled: (id) => props(byTestId(id)).disabled === true,
    async click(id) { await act(async () => { await props(need(id)).onClick?.({ stopPropagation() {}, preventDefault() {} }); }); await flush(); },
    async type(id, value) { await act(async () => { props(need(id)).onChange?.({ target: { value } }); }); },
    async check(id, checked) { await act(async () => { props(need(id)).onChange?.({ target: { checked } }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

const PACK = (over = {}) => ({ uid: 'pk1', origin: 'created', label: '$25 of tokens', state: 'ready', reason: null, price_id_suffix: 'abc123',
  on_sale: true, bonus_microusd: 2_500_000, sort: 0, adoptable: false, offer_starts_at: null, offer_ends_at: null, first_purchase_only: false, ...over });

// ------------------------------------------------------------------ the rules

test('parseOffer: each end a date and time or open, and the end after the start', () => {
  const a = '2026-11-01T09:00', b = '2026-11-08T09:00';
  assert.deepEqual(parseOffer('', ''), { ok: true, starts: null, ends: null }, 'both open');
  const both = parseOffer(a, b);
  assert.equal(both.ok, true);
  assert.equal(both.starts, new Date(a).toISOString(), 'sent as ISO UTC');
  assert.equal(both.ends, new Date(b).toISOString());
  assert.deepEqual(parseOffer(a, ''), { ok: true, starts: new Date(a).toISOString(), ends: null });
  assert.deepEqual(parseOffer(b, a), { ok: false, message: 'An offer must end after it starts.' });
  assert.deepEqual(parseOffer(a, a), { ok: false, message: 'An offer must end after it starts.' }, 'an empty window is refused too');
  assert.equal(parseOffer('next week', '').ok, false);
  assert.equal(offerInputOf(new Date(a).toISOString()), a, 'shown back in the reader\'s own zone');
  assert.equal(offerInputOf(null), '');
});

test('the pack row says when its bonus is offered, and first purchase only', () => {
  const when = (iso) => `@${iso.slice(5, 10)}`;
  assert.equal(offerLine(PACK(), when), null, 'neither: no line');
  assert.equal(offerLine(PACK({ offer_starts_at: '2026-11-01T09:00:00.000Z', offer_ends_at: '2026-11-08T09:00:00.000Z' }), when), 'Bonus offered from @11-01 to @11-08.');
  assert.equal(offerLine(PACK({ offer_ends_at: '2026-11-08T09:00:00.000Z' }), when), 'Bonus offered until @11-08.');
  assert.equal(offerLine(PACK({ offer_starts_at: '2026-11-01T09:00:00.000Z', first_purchase_only: true }), when), 'Bonus offered from @11-01. First purchase only.');
});

test('what a member is told: the bonus the Worker offers now, when it ends, and first purchase only', () => {
  const when = (iso) => `@${iso.slice(5, 10)}`;
  const pack = { bonus_microusd: 2_500_000, offer_ends_at: '2026-11-08T09:00:00.000Z', first_purchase_only: true };
  assert.deepEqual(packOfferLines(pack, when), ['Includes $2.50 of bonus tokens.', 'Bonus offered until @11-08.', 'For your first token purchase only.']);
  assert.deepEqual(packOfferLines({ ...pack, bonus_microusd: 0 }, when), ['For your first token purchase only.'], 'outside the window the Worker sends 0: no bonus, no end');
  assert.deepEqual(packOfferLines({ bonus_microusd: 2_500_000, offer_ends_at: null }, when), ['Includes $2.50 of bonus tokens.'], 'a bonus with no end');
  assert.deepEqual(packOfferLines({}, when), []);
});

// ------------------------------------------------------------------ HQ's Offer editor

test('HQ: Offer… saves the window and first purchase only, and refuses an end before the start without asking', async () => {
  const calls = [], done = [];
  const api = { update: async (...a) => { calls.push(['update', ...a]); }, archive: async () => {} };
  const pack = PACK({ offer_starts_at: '2026-11-01T09:00:00.000Z' });
  const m = await mount(h(PackControls, { pack, line: packLine(pack, 'live'), api, onDone: (s) => done.push(s) }));
  try {
    assert.match(m.text(), /Bonus offered from .+\./, 'the row says the offer it has');
    await m.click('hq-pack-offer-open-pk1');
    assert.equal(m.props(m.byTestId('hq-pack-offer-starts-pk1')).value, offerInputOf(pack.offer_starts_at), 'the fields start from the pack');
    assert.equal(m.props(m.byTestId('hq-pack-offer-ends-pk1')).value, '');
    await m.type('hq-pack-offer-ends-pk1', '2026-10-30T09:00');
    assert.match(m.text(), /An offer must end after it starts\./);
    assert.equal(m.disabled('hq-pack-offer-save-pk1'), true, 'Save is off while the window is wrong');
    await m.type('hq-pack-offer-ends-pk1', '2026-11-08T09:00');
    await m.check('hq-pack-offer-first-pk1', true);
    await m.click('hq-pack-offer-save-pk1');
    assert.deepEqual(calls.at(-1), ['update', 'pk1', { offer_starts_at: pack.offer_starts_at, offer_ends_at: new Date('2026-11-08T09:00').toISOString(), first_purchase_only: true }]);
    assert.deepEqual(done, ['$25 of tokens\'s offer is saved.']);
  } finally { await m.unmount(); }
});

test('HQ: emptying both fields opens the window: null and null are sent', async () => {
  const calls = [];
  const api = { update: async (...a) => { calls.push(['update', ...a]); }, archive: async () => {} };
  const pack = PACK({ offer_starts_at: '2026-11-01T09:00:00.000Z', offer_ends_at: '2026-11-08T09:00:00.000Z', first_purchase_only: true });
  const m = await mount(h(PackControls, { pack, line: packLine(pack, 'live'), api, onDone: () => {} }));
  try {
    await m.click('hq-pack-offer-open-pk1');
    await m.type('hq-pack-offer-starts-pk1', '');
    await m.type('hq-pack-offer-ends-pk1', '');
    await m.check('hq-pack-offer-first-pk1', false);
    await m.click('hq-pack-offer-save-pk1');
    assert.deepEqual(calls.at(-1), ['update', 'pk1', { offer_starts_at: null, offer_ends_at: null, first_purchase_only: false }]);
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ checkout

test('checkout: the pack summary draws the same offer lines under what it adds', () => {
  // CheckoutPage.jsx loads Stripe's publishable key at import, so its source is read (as checkout_token_pack_d755 does).
  const src = readFileSync(new URL('../src/pages/CheckoutPage.jsx', import.meta.url), 'utf8');
  const summary = src.slice(src.indexOf('export function OrderSummary'), src.indexOf('export default function'));
  assert.match(summary, /\{pack && packOfferLines\(pack\)\.map\(line => <p key=\{line\}[^>]*data-testid="checkout-pack-offer">\{line\}<\/p>\)\}/);
  assert.ok(summary.indexOf('packOfferLines(pack)') > summary.indexOf('to your top-up balance once the payment is confirmed'), 'after what it adds');
  const section = readFileSync(new URL('../src/components/products/TokenPacksSection.jsx', import.meta.url), 'utf8');
  assert.match(section, /\{packOfferLines\(pack\)\.map\(line => <p key=\{line\} className="text-sm">\{line\}<\/p>\)\}/, 'and the pack list');
});

// ------------------------------------------------------------------ D794's auto-reload

test('auto-reload never offers a first-purchase pack, and says why when a reload of one is refused', async () => {
  const { lastSkipped, packOptions } = await import('../src/pages/account/autoReloadModel.js');
  const packs = [{ uid: 'pack25', label: '$25 of tokens', first_purchase_only: false }, { uid: 'first10', label: '$10 of tokens', first_purchase_only: true }];
  assert.deepEqual(packOptions({ packs }), [{ uid: 'pack25', label: '$25 of tokens' }]);
  assert.equal(lastSkipped({ enabled: true, last_outcome: 'token_pack_first_purchase_only' }),
    'The last reload was not made: that pack is for a first token purchase only. Choose another pack on Billing.');
});
