// D4254 P5 (#4273, ps3) — the Decks tile: the deck and its variants as cards, the Versions
// timeline with each version's links, and the Compare summary.
//
//   1. Link counts: a link with no variant is Main's, one with a variant is that variant's;
//      an unread read is "Not recorded", a counted 0 is "No links".
//   2. The timeline: newest first, who saved each and when, its links.
//   3. The Compare summary, by card title: Added, Removed and Changed, matched by uid.
//   4. The mounted tile reads the current version's variants and links, and Compare opens
//      PD15's compare; Share this version is a writer's.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/decks_tile_4273.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { deckInvestorLinksApi } from '../src/lib/api/deckInvestorLinks.js';
import DecksTile from '../src/pages/raise/pitch/DecksTile.jsx';
import { deckCards, linksWord, timeline, variantsUnread } from '../src/pages/raise/pitch/decksTileModel.js';
import { compareLine, compareSummary } from '../src/pages/raise/pitch/compareModel.js';

const h = React.createElement;
const ok = (data) => ({ status: 'ok', data });
const V7 = { id: 70, version: 7, title: 'Seed deck', is_current: 1, created_at: '2026-11-03 09:00:00', by: { name: 'Fay Founder' }, shared_links: 3 };
const V6 = { id: 60, version: 6, title: 'Seed deck', created_at: '2026-10-28 09:00:00', by: { name: 'Fay Founder' }, shared_links: 0 };
const V5 = { id: 50, version: 5, title: 'Seed deck', created_at: '2026-10-20 09:00:00', by: null, shared_links: null };
const LINKS = { links: [{ id: 1, version: { variant: null } }, { id: 2, version: { variant: null } }, { id: 3, version: { variant: { uid: 'var-demo', name: 'Demo day' } } }] };
const VARIANTS = { variants: [{ uid: 'var-demo', name: 'Demo day', slide_order: [0, 2, 1], created_at: '2026-11-01 10:00:00' }, { uid: 'var-blue', name: 'Partner · Bluefern', slide_order: [], created_at: null }] };

test('#4273 link counts: Main\'s are the links with no variant; an unread read is "Not recorded", never 0', () => {
  assert.deepEqual([linksWord(null), linksWord(0), linksWord(1), linksWord(4)], ['Not recorded', 'No links', '1 link', '4 links']);
  const cards = deckCards({ current: V7, cards: 12, variants: ok(VARIANTS), links: ok(LINKS) });
  // Mutation checked: count every link for Main → "3 links" and this fails.
  assert.deepEqual(cards.map((c) => [c.kind, c.name, c.version, c.cards, c.links]), [
    ['Main', 'Seed deck', 'v7', '12 cards', '2 links'],
    ['Variant', 'Demo day', 'v7', '3 cards', '1 link'],
    ['Variant', 'Partner · Bluefern', 'v7', null, 'No links'],
  ]);
  assert.match(cards[0].edited, /^Edited .+ by Fay Founder$/);
  const unread = deckCards({ current: V7, variants: { status: 'error' }, links: { status: 'error' } });
  assert.deepEqual(unread.map((c) => [c.kind, c.links, c.cards]), [['Main', 'Not recorded', null]], 'no variant store read: the deck alone');
  assert.equal(variantsUnread({ status: 'error' }), true);
  assert.deepEqual(deckCards({ current: null }), []);
});

test('#4273 the timeline: newest first, who saved each and when, and its links', () => {
  const rows = timeline([V5, V7, V6]);
  assert.deepEqual(rows.map((r) => [r.label, r.current, r.links]), [['v7', true, '3 links'], ['v6', false, 'No links'], ['v5', false, 'Not recorded']]);
  assert.equal(rows[0].by, 'Fay Founder');
  assert.equal(rows[2].by, 'Not recorded', 'nobody named is not a blank');
});

test('#4273 the Compare summary, by card title, matched by uid', () => {
  const older = { version: 6, slides: [{ uid: 'a', title: 'Cover' }, { uid: 'b', title: 'Traction', n: 1 }, { uid: 'c', title: 'Team' }, { uid: 'x', title: 'Old slide' }] };
  const newer = { version: 7, slides: [{ uid: 'a', title: 'Cover' }, { uid: 'c', title: 'Team', n: 2 }, { uid: 'b', title: 'Traction', n: 9 }, { uid: 'u', title: 'Use of funds' }] };
  // Mutation checked: match by place instead of uid → the moved, unchanged cards read as changed.
  assert.deepEqual(compareSummary(older, newer), { added: ['Use of funds'], removed: ['Old slide'], changed: ['Team', 'Traction'] });
  assert.equal(compareLine(older, newer), 'v6 → v7 · Added: Use of funds · Removed: Old slide · Changed: Team, Traction');
  assert.equal(compareLine(older, { version: 7, slides: older.slides }), 'v6 → v7 · No card changed');
});

async function mount(props) {
  const orig = { v: deckInvestorLinksApi.deckVariants, l: deckInvestorLinksApi.investorLinks, g: api.deckGet };
  const calls = [];
  deckInvestorLinksApi.deckVariants = async (id) => { calls.push(['variants', id]); return VARIANTS; };
  deckInvestorLinksApi.investorLinks = async (id) => { calls.push(['links', id]); return LINKS; };
  api.deckGet = async (id) => ({ deck: { id, version: id === 60 ? 6 : 7, slides: [{ uid: 'a', title: 'Cover' }, ...(id === 70 ? [{ uid: 'u', title: 'Use of funds' }] : [])] } });
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(DecksTile, { projectId: 7, versions: [V7, V6, V5], current: V7, cardCount: 12, readOnly: false, ...props }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, text: () => text(container).replace(/\s+/g, ' '),
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      deckInvestorLinksApi.deckVariants = orig.v; deckInvestorLinksApi.investorLinks = orig.l; api.deckGet = orig.g;
    },
  };
}

test('#4273 the mounted tile: the current version\'s variants and links, Compare with its line, Share this version for a writer', async () => {
  const m = await mount({});
  try {
    assert.deepEqual(m.calls.sort(), [['links', 70], ['variants', 70]]);
    assert.match(m.text(), /Seed deck Main v7 · 12 cards/);
    assert.match(m.text(), /Demo day Variant v7 · 3 cards/);
    assert.ok(!m.by('decks-tile-compare-70'), 'the current version is not compared with itself');
    assert.ok(m.by('decks-tile-share-60'), 'a writer can share an older version');
    await m.press('decks-tile-compare-60');
    assert.ok(m.by('pitch-compare'), 'Compare opens PD15');
    assert.match(m.text(), /v6 → v7 · Added: Use of funds/);
  } finally { await m.unmount(); }
  const r = await mount({ readOnly: true });
  try { assert.ok(!r.by('decks-tile-share-60'), 'a reader shares nothing'); } finally { await r.unmount(); }
});
