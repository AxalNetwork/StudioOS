/**
 * #9106 (gap g14 of #7675): a founder on /network/introductions offers an introduction between two accepted ties
 * through the sheet D6637 built. The header op is live only when the page supplies it, stays secondary (the canvas,
 * NID01, keeps the primary for Request an introduction), works while the ledger loads or has failed,
 * and a sent offer says so without reloading the ledger: the propositions go to the two ties, not the founder.
 * Sample names only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_offer_intro_g14.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { founderZoneActions } from '../src/workspaces/founderZoneActions.js';
import { networkIntroOffersApi } from '../src/lib/api/networkIntroOffers.js';
import { investorAsksApi } from '../src/lib/api/investorAsks.js';

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const text = (n) => (n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');

test('Offer one is live only when the page supplies its handler; it is not the primary; Request an intro opens the request through Axal', () => {
  const calls = [];
  const ops = founderZoneActions('network/introductions', { handlers: { offerIntroduction: { onClick: () => calls.push('open'), title: 'Offer an introduction between two of your accepted ties.' } } });
  const offer = ops.find((a) => a.label === 'Offer one');
  // Mutation checked: the row left as `unbuilt` → the op is held, not live.
  assert.ok(offer, 'Offer one is drawn');
  assert.ok(!offer.disabled, 'and live');
  assert.ok(!offer.primary, 'secondary: the canvas keeps the primary for Request an introduction');
  offer.onClick();
  assert.deepEqual(calls, ['open']);
  assert.doesNotMatch(offer.title, /#\d+/);
  assert.equal(founderZoneActions('network/introductions').find((a) => a.label === 'Offer one'), undefined, 'no handler, no op');
  const request = founderZoneActions('network/introductions').find((a) => a.label === 'Request an intro');
  assert.ok(request && !request.disabled, 'Request an intro is live after D9068');
  assert.equal(request.to, '/network/introductions/requests/new');
});

async function mountPage(listIntroductions, run) {
  const restore = installDocument('', { focus: true });
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.querySelectorAll = () => [];
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.offsetParent = {}; return n; };
  const { api } = await import('../src/lib/api.js');
  const original = { ...api };
  const oldPeople = networkIntroOffersApi.people, oldOffer = networkIntroOffersApi.offer;
  const sent = [];
  let listed = 0;
  api.networkIntroductionsList = (...a) => { listed += 1; return listIntroductions(...a); };
  const oldAsks = investorAsksApi.received;
  investorAsksApi.received = async () => ({ asks: [] });
  networkIntroOffersApi.people = async () => ({ people: [{ id: 2, name: 'Alex Sample' }, { id: 3, name: 'Bea Sample' }], next_cursor: null });
  networkIntroOffersApi.offer = async (...pair) => { sent.push(pair); return { ok: true }; };
  const { MemoryRouter } = await import('react-router-dom');
  const { default: Page } = await import('../src/pages/founder/FounderNetworkIntroductions.jsx');
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  try {
    await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: ['/network/introductions'] }, React.createElement(Page, { embedded: true }))); });
    await run({ box, sent, listed: () => listed, find: (fn) => walk(box).find((n) => fn(props(n), n)) });
  } finally {
    await act(async () => root.unmount());
    Object.assign(api, original);
    networkIntroOffersApi.people = oldPeople; networkIntroOffersApi.offer = oldOffer; investorAsksApi.received = oldAsks;
    globalThis.matchMedia = oldMedia; restore();
  }
}

test('the founder’s header opens the sheet, and a sent offer is said once without a new ledger row', async () => {
  const { OFFERED_NOTICE } = await import('../src/pages/founder/FounderNetworkIntroductions.jsx');
  await mountPage(async () => ({ propositions: [] }), async ({ box, sent, listed, find }) => {
    const button = find((p, n) => n.tagName === 'BUTTON' && text(n).trim() === 'Offer one');
    // Mutation checked: the page's `handlers` dropped → the op is not drawn.
    assert.ok(button, 'Offer one is on the founder’s mounted page');
    await act(async () => props(button).onClick());
    assert.ok(find((p) => p['data-testid'] === 'network-intro-offer'), 'the names-only sheet opens');
    assert.match(text(box), /Alex Sample/);
    await act(async () => props(find((p) => p['aria-label'] === 'First person')).onChange({ target: { value: '2' } }));
    await act(async () => props(find((p) => p['aria-label'] === 'Second person')).onChange({ target: { value: '3' } }));
    await act(async () => { await props(find((p) => typeof p.onSubmit === 'function')).onSubmit({ preventDefault() {} }); });
    assert.deepEqual(sent, [[2, 3]]);
    // Mutation checked: onOffered not closing the sheet → it stays open over the notice.
    assert.equal(find((p) => p['data-testid'] === 'network-intro-offer'), undefined, 'the sheet closes');
    // Mutation checked: the notice not set → nothing says the offer went.
    assert.equal(text(find((p) => p['data-testid'] === 'status-network-intro-offered')), OFFERED_NOTICE);
    assert.equal(props(find((p) => p['data-testid'] === 'status-network-intro-offered')).role, 'status', 'a polite status line');
    assert.doesNotMatch(OFFERED_NOTICE, /ledger|row|appear|below/i, 'the notice does not promise a row');
    assert.equal(listed(), 1, 'the ledger is not reloaded to look for the offer');
  });
});

test('the op works while the ledger is still loading, and after it failed', async () => {
  await mountPage(() => new Promise(() => {}), async ({ find }) => {
    const button = find((p, n) => n.tagName === 'BUTTON' && text(n).trim() === 'Offer one');
    assert.ok(button && !props(button).disabled, 'live while the ledger loads');
    await act(async () => props(button).onClick());
    assert.ok(find((p) => p['data-testid'] === 'network-intro-offer'));
  });
  await mountPage(async () => { throw new Error('Synthetic ledger failure'); }, async ({ box, find }) => {
    assert.match(text(box), /Synthetic ledger failure/);
    const button = find((p, n) => n.tagName === 'BUTTON' && text(n).trim() === 'Offer one');
    assert.ok(button && !props(button).disabled, 'live after the ledger failed');
    await act(async () => props(button).onClick());
    assert.ok(find((p) => p['data-testid'] === 'network-intro-offer'));
  });
});
