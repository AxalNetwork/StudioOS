// D6165 (#6165) — the deck the venture granted the investor, on the deal page:
// the Deck card (canvas DL1 `deckK`) on Overview and Documents, and the plain
// read-only viewer (the share link's card view in the shared Lightbox), on
// D1587's `GET /api/deals/:id/deck`.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_deck_6165.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { DECK_CARD, deckCardOf, frozenDay } from '../src/pages/deal/dealDeckModel.js';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const NOT_GRANTED = 'The venture has not shared its deck with you on this deal yet.';
const GONE = 'The version the venture shared is no longer available.';
const SLIDES = [
  { title: 'Harbor Ledger', blocks: [{ id: 'h1', kind: 'text', style: 'heading', text: 'Ledgers for harbours' }, { id: 'p1', kind: 'text', style: 'paragraph', text: 'Port fees, reconciled.' }] },
  { title: 'Traction', blocks: [{ id: 'm1', kind: 'metric', label: 'Ports live', value: '12' }] },
];
const GRANTED = {
  granted: true, grant: { uid: 'g1', granted_at: '2026-11-02 10:00:00' }, venture: 'Harbor Ledger',
  deck: { title: 'Seed round deck', theme: null, frozen: { version: 4, as_of: '2026-10-21 09:30:00' }, slides: SLIDES },
  included: { figures: true, sources: false, notes: false, bands: false },
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the card: loading, unreadable, the Worker\'s own sentence when not granted, and the granted version\'s title, version and date', () => {
  assert.deepEqual(deckCardOf({ status: 'loading' }), { state: 'loading' });
  assert.deepEqual(deckCardOf({ status: 'unreadable' }), { state: 'unreadable' });
  assert.deepEqual(deckCardOf({ status: 'ready', data: { granted: false, message: NOT_GRANTED } }), { state: 'not_granted', line: NOT_GRANTED });
  assert.deepEqual(deckCardOf({ status: 'ready', data: { granted: false, message: GONE } }), { state: 'not_granted', line: GONE }, 'the Worker\'s sentence, whichever it is');
  assert.equal(deckCardOf({ status: 'ready', data: {} }).state, 'not_granted', 'an answer without granted: true opens no viewer');
  assert.equal(deckCardOf({ status: 'ready', data: { granted: true } }).state, 'not_granted', 'granted with no deck opens no empty viewer');
  assert.equal(deckCardOf({ status: 'ready', data: { ...GRANTED, granted: false, message: NOT_GRANTED } }).state, 'not_granted', 'granted: false is not granted, whatever else the answer carries');
  const c = deckCardOf({ status: 'ready', data: GRANTED });
  assert.equal(c.state, 'ready');
  assert.equal(c.title, 'Seed round deck');
  assert.equal(c.line, 'Harbor Ledger · v4 · frozen as of 21 Oct 2026');
  assert.equal(c.deck, GRANTED.deck, 'the viewer gets the Worker\'s deck object itself, nothing rebuilt');
});

test('the card: a missing title, version or date reads Not recorded, never a blank, a 0 or a made-up date', () => {
  const c = deckCardOf({ status: 'ready', data: { granted: true, venture: null, deck: { title: '  ', frozen: { version: null, as_of: null }, slides: [] } } });
  assert.equal(c.title, 'Not recorded');
  assert.equal(c.titleMissing, true);
  assert.equal(c.line, 'Version not recorded · frozen date not recorded');
  assert.equal(frozenDay('2026-10-21T23:30:00Z'), '21 Oct 2026', 'UTC, not the reader\'s zone');
  assert.equal(frozenDay('not a date'), null);
  assert.equal(frozenDay(null), null);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handlerWith(deck) {
  return (url) => {
    if (/\/api\/deals\/4\/deck(\?|$)/.test(url)) return deck(url);
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' } });
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ first_visit: true, changes: [] });
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/deals\/4\/activity/.test(url)) return response([]);
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

async function mounted(url, user, handler) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push(`${(init?.method || 'GET').toUpperCase()} ${String(u)}`); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) }))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const press = async (n) => { await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  return {
    requests, byId,
    has: (id) => byId(id).length > 0,
    textOf: (id) => text(byId(id)[0]),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await press(n); },
    async clickText(t) { const n = nodes().find((x) => x.tagName === 'BUTTON' && text(x).includes(t)); assert.ok(n, `no button ${t}`); await press(n); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

const deckReads = (v) => v.requests.filter((r) => /\/api\/deals\/4\/deck(\?|$)/.test(r));

test('granted: the Overview card shows the title, version and frozen date, and Open the deck draws the returned slides, read-only', async () => {
  const v = await mounted('/deals/4', INVESTOR, handlerWith(() => response(GRANTED)));
  try {
    assert.equal(v.textOf('deal-deck-title'), 'Seed round deck');
    assert.equal(v.textOf('deal-deck-line'), 'Harbor Ledger · v4 · frozen as of 21 Oct 2026');
    assert.equal(v.textOf('deal-deck-open'), DECK_CARD.open);
    assert.ok(!v.has('deal-deck-viewer'), 'nothing opens until asked');
    const before = v.requests.length;
    await v.click('deal-deck-open');
    assert.ok(v.has('deal-deck-viewer'), 'the shared Lightbox opens');
    const cards = v.textOf('deal-deck-cards');
    for (const words of ['Ledgers for harbours', 'Port fees, reconciled.', 'Ports live', '12']) assert.ok(cards.includes(words), words);
    assert.equal(v.byId('deal-deck-cards-card-0').length + v.byId('deal-deck-cards-card-1').length, 2, 'every returned slide, and no other');
    assert.ok(!v.has('deal-deck-cards-card-2'));
    assert.deepEqual(v.requests.slice(before), [], 'opening the viewer sends nothing: no read again, no write of any kind');
    assert.deepEqual(v.requests.filter((r) => /\/deck/.test(r)), ['GET /api/deals/4/deck'], 'one deck request, a GET');
  } finally { await v.close(); }
});

test('not granted: the Worker\'s sentence, and no viewer and no Open the deck', async () => {
  for (const message of [NOT_GRANTED, GONE]) {
    const v = await mounted('/deals/4', INVESTOR, handlerWith(() => response({ granted: false, message })));
    try {
      assert.equal(v.textOf('deal-deck-not-granted'), message);
      assert.ok(!v.has('deal-deck-open') && !v.has('deal-deck-viewer'), 'never an empty viewer');
    } finally { await v.close(); }
  }
});

test('a failed read says so with Try again, leaves Overview standing, and Try again reads once more', async () => {
  let fail = true;
  const v = await mounted('/deals/4', INVESTOR, handlerWith(() => (fail ? response({ error: 'deck_unreadable', message: 'The deck could not be read. Try again.' }, 503) : response(GRANTED))));
  try {
    assert.match(v.textOf('deal-deck-unreadable'), /The deck could not be read\./);
    assert.ok(!v.has('deal-deck-open'));
    for (const id of ['deal-overview', 'deal-terms', 'deal-round', 'deal-details']) assert.ok(v.has(id), `${id} still stands`);
    fail = false;
    await v.clickText('Try again');
    assert.equal(deckReads(v).length, 2);
    assert.equal(v.textOf('deal-deck-title'), 'Seed round deck');
  } finally { await v.close(); }
});

test('the Documents tab carries the same card in place of the old grey slot', async () => {
  const v = await mounted('/deals/4/documents', INVESTOR, handlerWith(() => response(GRANTED)));
  try {
    assert.equal(v.textOf('deal-docs-deck-title'), 'Seed round deck');
    assert.ok(!/once a per-deal deck grant exists/.test(v.textOf('deal-documents')), 'the out-of-date words are gone');
  } finally { await v.close(); }
});

test('a founder and staff see no deck card and never ask for the investor\'s deck', async () => {
  for (const user of [{ id: 30, role: 'founder', founder_id: 9, name: 'Bram', email: 'bram@example.com' }, { id: 1, role: 'admin', name: 'Cy', email: 'cy@example.com' }]) {
    const v = await mounted('/deals/4', user, handlerWith(() => response(GRANTED)));
    try {
      assert.ok(v.has('deal-overview'), `${user.role}: Overview drawn`);
      assert.ok(!v.has('deal-deck') && !v.has('deal-deck-slot'), `${user.role}: no deck card`);
      assert.equal(deckReads(v).length, 0, `${user.role}: no deck read`);
    } finally { await v.close(); }
  }
});

test('source: the old slot is gone, every colour has its dark pair, and the card stays inside a 390 px column', () => {
  const model = read('src/pages/deal/dealFrameModel.js');
  assert.ok(!/DECK_SLOT/.test(model), 'DECK_SLOT is removed');
  for (const f of ['src/pages/deal/DealOverview.jsx', 'src/pages/deal/DealWorkTabs.jsx']) assert.ok(!/DECK_SLOT/.test(read(f)), f);
  const src = read('src/pages/deal/DealDeck.jsx');
  assert.ok(!/\b(post|grant|withdraw)\(|method:/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'the viewer writes nothing');
  assert.match(src, /flex min-w-0 flex-col/, 'the card can shrink to a phone column');
  assert.match(src, /break-words/, 'a long title wraps at 390 px');
  assert.match(src, /<DeckCardView deck=\{card\.deck\}/, 'the share link\'s card view, fed the Worker\'s deck');
  for (const m of src.matchAll(/text-axal-(ink|muted)\b/g)) assert.ok(src.slice(m.index, m.index + 60).includes('dark:'), `dark pair for ${m[0]}`);
});
