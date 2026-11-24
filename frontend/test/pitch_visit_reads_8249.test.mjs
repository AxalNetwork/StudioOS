// D8249 (#8249, Pitch analytics PS-08 B) — per-visit card reads on an investor
// link's journey.
//
//   1. A link with several visits: each visit's step says "Read N cards ·
//      longest on X" with that card's measured seconds.
//   2. A visit with no heartbeat reads Not recorded, with why; never "0 cards".
//   3. Tracking off draws no visit line (the tiles keep Tracking off, D6062);
//      a failed read keeps Unavailable.
//   4. The bound: a link with more visits than the read covers says so.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_visit_reads_8249.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ViewerAnalyticsSheet from '../src/pages/raise/pitch/ViewerAnalyticsSheet.jsx';
import { NO_VISIT_READ, journeyRows, visitReadOf, visitReadsNote } from '../src/pages/raise/pitch/slideAnalyticsModel.js';

const h = React.createElement;
const CARDS = [
  { card_uid: 'cover', index: 0, title: '[Cover]', seconds: 12 },
  { card_uid: 'traction', index: 1, title: '[Traction]', seconds: 55 },
  { card_uid: 'market', index: 2, title: '[Market]', seconds: null },
  { card_uid: 'ask', index: 3, title: null, seconds: 38 },
];
const read = (view_id, at, cards) => {
  if (!cards.length) return { view_id, at, cards_read: null, seconds: null, longest: null, cards: null };
  const longest = cards.reduce((a, c) => (c.seconds > a.seconds ? c : a), cards[0]);
  return { view_id, at, cards_read: cards.length, seconds: cards.reduce((n, c) => n + c.seconds, 0), longest, cards };
};
const LINK = (over = {}) => ({
  deck_id: 6, link_id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 },
  nda: { state: 'not_required' }, status: 'live', withdrawn_at: null, time_per_slide: true,
  views: 3, last_viewed_at: '2026-11-09 07:12:00', read_seconds: 105, cards: CARDS, most_read: CARDS[1], ask_card_uid: 'ask',
  timeline: [
    { kind: 'opened', at: '2026-11-06 18:40:00', view_id: 1 },
    { kind: 'revisited', at: '2026-11-07 21:10:00', view_id: 2 },
    { kind: 'revisited', at: '2026-11-09 07:12:00', view_id: 3 },
    { kind: 'reached_ask', at: '2026-11-09 07:14:00', view_id: 3 },
  ],
  visit_reads: [
    read(3, '2026-11-09 07:12:00', [{ card_uid: 'traction', index: 1, title: '[Traction]', seconds: 15 }, { card_uid: 'ask', index: 3, title: null, seconds: 30 }]),
    read(2, '2026-11-07 21:10:00', []),
    read(1, '2026-11-06 18:40:00', [
      { card_uid: 'cover', index: 0, title: '[Cover]', seconds: 12 },
      { card_uid: 'traction', index: 1, title: '[Traction]', seconds: 40 },
      { card_uid: 'ask', index: 3, title: null, seconds: 8 },
    ]),
  ],
  visit_reads_limit: 50,
  ...over,
});
const OFF = { time_per_slide: false, cards: null, most_read: null, read_seconds: null, visit_reads: null };
const ROW = { id: 11, investor: LINK().investor, version: { variant: null }, nda: LINK().nda, expires_at: null, status: 'live', withdrawn_at: null, time_per_slide: true, created_at: '2026-11-06 10:02:00', analytics: { views: 3 } };
const step = (answer, viewId) => journeyRows(answer, ROW).find((r) => r.view_id === viewId && r.kind !== 'reached_ask');

test('D8249 1: several visits: each says which cards it read and the longest, from measured seconds', () => {
  const a = LINK();
  assert.deepEqual(visitReadOf(a, step(a, 1)), { kind: 'value', words: 'Read 3 cards · longest on [Traction]', sub: '40 s' });
  assert.deepEqual(visitReadOf(a, step(a, 3)), { kind: 'value', words: 'Read 2 cards · longest on Card 4', sub: '30 s' }, 'an untitled card is named by its place');
  const one = LINK({ visit_reads: [read(1, 'x', [{ card_uid: 'cover', index: 0, title: '[Cover]', seconds: 75 }])] });
  assert.deepEqual(visitReadOf(one, step(one, 1)), { kind: 'value', words: 'Read 1 card · longest on [Cover]', sub: '1 m 15 s' });
  // Only a visit carries reads: not the NDA, the ask, the link's creation.
  for (const r of journeyRows(a, ROW).filter((x) => !['opened', 'revisited'].includes(x.kind))) assert.equal(visitReadOf(a, r), null, r.kind);
});

test('D8249 2: a visit with no heartbeat reads Not recorded, never 0 cards', () => {
  const a = LINK();
  assert.deepEqual(visitReadOf(a, step(a, 2)), { kind: 'not_recorded', words: 'Not recorded', why: NO_VISIT_READ });
  // A longest card without measured seconds is not a read either.
  const zero = LINK({ visit_reads: [{ view_id: 1, at: 'x', cards_read: 1, seconds: 0, longest: { card_uid: 'cover', index: 0, title: 'C', seconds: 0 }, cards: [] }] });
  assert.equal(visitReadOf(zero, step(zero, 1)).kind, 'not_recorded');
  // A visit older than the bound has no line, rather than a made-up Not recorded.
  assert.equal(visitReadOf(LINK({ visit_reads: [] }), step(LINK(), 1)), null);
});

test('D8249 3: tracking off and a read without the field draw no visit line', () => {
  const off = LINK(OFF);
  assert.equal(visitReadOf(off, step(off, 1)), null);
  assert.equal(visitReadOf(LINK({ time_per_slide: false }), step(LINK(), 1)), null, 'off wins even if reads came back');
  assert.equal(visitReadOf(LINK({ visit_reads: undefined }), step(LINK(), 1)), null);
  assert.equal(visitReadsNote(off), null);
});

test('D8249 4: a link with more visits than the read covers says so', () => {
  assert.equal(visitReadsNote(LINK()), null);
  assert.match(visitReadsNote(LINK({ views: 51 })), /^Cards read are shown for the 50 newest visits; older visits are on the journey without them\.$/);
});

// ---------------------------------------------------------------- the mounted sheet

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mountSheet(answer) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  globalThis.fetch = async () => answer();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(ViewerAnalyticsSheet, { deck: { id: 6, version: 6 }, row: ROW, onClose() {} }))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const all = (prefix) => walk(document.body).filter((n) => String(pr(n)['data-testid'] || '').startsWith(prefix));
  return {
    by, all, text: (id) => text(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    state: (id) => pr(by(id))['data-figure-state'],
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('D8249 sheet: several visits, one with no heartbeat, on the journey', async () => {
  const v = await mountSheet(() => response(LINK()));
  try {
    assert.equal(v.state('viewer-analytics-visit-read-1'), 'value');
    assert.equal(v.text('viewer-analytics-visit-read-1'), 'Read 3 cards · longest on [Traction] · 40 s');
    assert.equal(v.text('viewer-analytics-visit-read-3'), 'Read 2 cards · longest on Card 4 · 30 s');
    assert.equal(v.state('viewer-analytics-visit-read-2'), 'not_recorded');
    assert.equal(v.text('viewer-analytics-visit-read-2'), `Not recorded · ${NO_VISIT_READ}`);
    assert.equal(v.all('viewer-analytics-visit-read-').length, 3, 'one line per visit, none on the ask step');
    assert.doesNotMatch(v.text('viewer-analytics-timeline'), /\b0 cards\b|\b0 s\b/);
    assert.ok(!v.by('viewer-analytics-visit-reads-note'));
  } finally { await v.close(); }
});

test('D8249 sheet: tracking off keeps Tracking off and draws no visit line; a failed read stays Unavailable', async () => {
  const off = await mountSheet(() => response(LINK(OFF)));
  try {
    assert.equal(off.state('viewer-analytics-time'), 'tracking_off');
    assert.equal(off.state('viewer-analytics-consent-off'), 'tracking_off');
    assert.ok(off.by('viewer-analytics-step-revisited'), 'the visits are still on the journey');
    assert.equal(off.all('viewer-analytics-visit-read-').length, 0);
    assert.doesNotMatch(off.text('viewer-analytics-timeline'), /Not recorded|Read \d/);
  } finally { await off.close(); }
  const bad = await mountSheet(() => response({ error: 'x' }, 500));
  try {
    assert.equal(bad.state('viewer-analytics-unreadable'), 'unreadable');
    assert.ok(!bad.by('viewer-analytics-timeline'));
    assert.equal(bad.all('viewer-analytics-visit-read-').length, 0);
  } finally { await bad.close(); }
});
