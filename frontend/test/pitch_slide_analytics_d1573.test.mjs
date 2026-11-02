// D1573 (#3820, PD-8 · pd37 and pd35) — per-slide investor analytics in the
// studio: the words (never a 0 for what was not counted), the "Viewer
// analytics" sheet read through the adapter (timed, Time per slide off, and
// "Views could not be read." with Try again), the Share ▾ table's Analytics
// cell and "Time per slide" switch, and the new link's switch.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_slide_analytics_d1573.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import InvestorLinksTable from '../src/pages/raise/pitch/InvestorLinksTable.jsx';
import ViewerAnalyticsSheet from '../src/pages/raise/pitch/ViewerAnalyticsSheet.jsx';
import ShareDialog from '../src/pages/raise/pitch/ShareDialog.jsx';
import { DEFAULT_SHARE, shareBody } from '../src/pages/raise/pitch/shareModel.js';
import { WITHDRAW_BODY } from '../src/pages/raise/pitch/InvestorLinksTable.jsx';
import {
  CONSENT_OFF, OFF_KEEPS, VIEWS_UNREAD, analyticsCellWords, barsOf, durationWords, lastSeenWords, mostReadWords, ndaPill, timelineRows,
} from '../src/pages/raise/pitch/slideAnalyticsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const DECK = { id: 6, version: 3, created_at: '2026-10-21 09:00:00' };
const NOW = new Date('2026-11-02T12:00:00Z');
const ROW = (over = {}) => ({
  id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 }, version: { variant: null },
  nda: { state: 'accepted', accepted_at: '2026-10-12 09:15:00' }, expires_at: null, view_cap: { limit: null, used: 4 },
  watermark: null, status: 'live', withdrawn_at: null, time_per_slide: true,
  analytics: { views: 4, last_viewed_at: '2026-11-01 18:02:00', read_seconds: 372 }, ...over,
});
const CARDS = [
  { card_uid: 'cover', index: 0, title: '[Cover]', seconds: 12 },
  { card_uid: 'traction', index: 1, title: '[Traction]', seconds: 108 },
  { card_uid: 'market', index: 2, title: null, seconds: null },
];
const ANSWER = (over = {}) => ({
  deck_id: 6, link_id: 11, investor: ROW().investor, nda: ROW().nda, status: 'live', withdrawn_at: null, time_per_slide: true,
  views: 4, last_viewed_at: '2026-11-01 18:02:00', read_seconds: 372, cards: CARDS, most_read: CARDS[1], ask_card_uid: null,
  timeline: [
    { kind: 'opened', at: '2026-10-12 09:14:00', view_id: 1 },
    { kind: 'nda_accepted', at: '2026-10-12 09:15:00', view_id: null },
    { kind: 'reached_ask', at: '2026-10-12 09:21:00', view_id: 1 },
    { kind: 'revisited', at: '2026-10-14 18:02:00', view_id: 2 },
  ],
  ...over,
});

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push([key, init.body ?? null]);
    return (handle[key] || (() => response({ ok: true })))(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(element));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, text: () => textOf(document.body), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick(); }); await settle(); },
    toggle: async (id, checked) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { checked } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('the words: pd35\'s Analytics cell and pd37\'s, never a 0 for what was not counted', () => {
  assert.equal(durationWords(108), '1 m 48 s');
  assert.equal(durationWords(372), '6 m 12 s');
  assert.equal(durationWords(45), '45 s');
  assert.equal(durationWords(120), '2 m');
  assert.equal(durationWords(3720), '1 h 2 m');
  for (const none of [null, undefined, 0, -3, 'x']) assert.equal(durationWords(none), null, String(none));
  assert.equal(analyticsCellWords(ROW(), NOW), 'Views 4 · Time 6 m 12 s · Last seen yesterday');
  assert.equal(analyticsCellWords(ROW({ time_per_slide: false, analytics: { views: 1, last_viewed_at: '2026-11-02 08:00:00', read_seconds: null } }), NOW), 'Views 1 · visit counts only');
  assert.equal(analyticsCellWords(ROW({ analytics: { views: 0, last_viewed_at: null, read_seconds: null } }), NOW), 'Views 0', 'nobody opened it: no Time, no Last seen');
  assert.equal(analyticsCellWords(ROW({ analytics: {} }), NOW), 'Views not recorded');
  assert.equal(lastSeenWords('2026-11-02 01:00:00', NOW), 'today');
  assert.equal(lastSeenWords('2026-10-30 01:00:00', NOW), '3 days ago');
  assert.equal(lastSeenWords('2026-10-12 01:00:00', NOW), '12 Oct');
  assert.deepEqual(ndaPill(ROW().nda), { tone: 'pos', words: 'Accepted the NDA 12 Oct' });
  assert.equal(ndaPill({ state: 'not_accepted' }).words, 'NDA not accepted yet');
  assert.equal(mostReadWords(ANSWER()), '[Traction] · 1 m 48 s');
  assert.equal(mostReadWords(ANSWER({ most_read: null })), null);
  const bars = barsOf(ANSWER());
  assert.deepEqual(bars.map((b) => b.label), ['12 s', '1 m 48 s', 'Not read'], 'an untimed card is "Not read", never "0 s"');
  assert.deepEqual(bars.map((b) => b.most), [false, true, false]);
  assert.equal(bars[1].height, 1);
  assert.equal(bars[2].title, 'Card 3');
  assert.deepEqual(timelineRows(ANSWER()).map((r) => `${r.at} ${r.words}`), [
    '12 Oct · 09:14 Opened', '12 Oct · 09:15 Accepted the NDA', '12 Oct · 09:21 Reached the ask', '14 Oct · 18:02 Revisited',
  ]);
  assert.match(WITHDRAW_BODY, /Analytics so far are kept\./);
  // The canvas's own words, written out, so a changed constant fails here.
  assert.equal(VIEWS_UNREAD, 'Views could not be read.');
  assert.equal(CONSENT_OFF, 'Visit counts only. Time per slide is off for this link.');
  assert.equal(OFF_KEEPS, 'Off keeps visit counts only');
});

test('pd37: the sheet reads one link through the adapter: the investor, the NDA pill, the bars, the most-read card and the timeline', async () => {
  const v = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW(), onClose() {} }), {
    'GET /api/decks/6/investor-links/11/analytics': () => response(ANSWER()),
  });
  try {
    const text = v.text();
    for (const words of ['[Pat Partner] · [Fund A]', 'Accepted the NDA 12 Oct', 'Time per slide', '[Traction] · 1 m 48 s', 'Not read', 'Visit timeline', 'Accepted the NDA', 'Reached the ask', 'Revisited', '14 Oct · 18:02']) {
      assert.ok(text.includes(words), words);
    }
    assert.ok(v.has('viewer-analytics-bar-traction'));
    assert.doesNotMatch(text, /\b0 s\b/, 'nothing reads 0 seconds');
    assert.deepEqual(v.seen.map((s) => s[0]), ['GET /api/decks/6/investor-links/11/analytics'], 'the sheet only reads');
  } finally { await v.close(); }
});

test('pd37: with Time per slide off, "Visit counts only. Time per slide is off for this link." and no bars', async () => {
  const v = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW({ time_per_slide: false }), onClose() {} }), {
    'GET /api/decks/6/investor-links/11/analytics': () => response(ANSWER({ time_per_slide: false, cards: null, most_read: null, read_seconds: null })),
  });
  try {
    assert.ok(v.text().includes(CONSENT_OFF));
    assert.ok(!v.has('viewer-analytics-bars'));
    assert.ok(v.text().includes('Opened'), 'the visit timeline still shows');
  } finally { await v.close(); }
});

test('pd37: a failed read says "Views could not be read." with Try again, never zeros', async () => {
  let calls = 0;
  const v = await mount(h(ViewerAnalyticsSheet, { deck: DECK, row: ROW(), onClose() {} }), {
    'GET /api/decks/6/investor-links/11/analytics': () => { calls += 1; return calls === 1 ? response({ error: 'boom' }, 500) : response(ANSWER()); },
  });
  try {
    assert.ok(v.text().includes(VIEWS_UNREAD));
    assert.ok(!v.has('viewer-analytics-bars'));
    await v.click('viewer-analytics-retry');
    assert.equal(calls, 2);
    assert.ok(v.text().includes('[Traction] · 1 m 48 s'));
  } finally { await v.close(); }
});

test('pd35: the Analytics cell opens the sheet, and the row\'s Time per slide switch writes the consent', async () => {
  let off = false;
  const handle = {
    'GET /api/decks/6/investor-links': () => response({ deck_id: 6, version: 3, links: [
      ROW({ time_per_slide: !off, analytics: off ? { views: 4, last_viewed_at: '2026-11-01 18:02:00', read_seconds: null } : ROW().analytics }),
      ROW({ id: 12, status: 'withdrawn', investor: { label: '[Sam Second]', fund: null, prospect_id: 8 } }),
    ] }),
    'PUT /api/decks/6/investor-links/11/time-per-slide': () => { off = true; return response({ ok: true, link: ROW({ time_per_slide: false }) }); },
    'GET /api/decks/6/investor-links/11/analytics': () => response(ANSWER()),
  };
  const v = await mount(h(InvestorLinksTable, { deck: DECK }), handle);
  try {
    assert.ok(v.text().includes('Time per slide'));
    assert.match(v.text(), /Views 4 · Time 6 m 12 s · Last seen/);
    assert.equal(v.props('investor-link-time-12').disabled, true, 'a withdrawn link stores nothing more');
    await v.click('investor-link-analytics-11');
    assert.ok(v.has('viewer-analytics'));
    assert.ok(v.seen.some((s) => s[0] === 'GET /api/decks/6/investor-links/11/analytics'));
    assert.ok(!v.seen.some((s) => s[0].startsWith('PUT')), 'opening the sheet writes nothing');
    await v.toggle('investor-link-time-11', false);
    const put = v.seen.find((s) => s[0] === 'PUT /api/decks/6/investor-links/11/time-per-slide');
    assert.ok(put);
    assert.deepEqual(JSON.parse(put[1]), { on: false });
    assert.ok(v.text().includes(OFF_KEEPS));
    assert.match(v.text(), /Views 4 · visit counts only/);
  } finally { await v.close(); }
});

test('pd35\'s row editor: the new link\'s Time per slide switch, on by default, sends time_per_slide', async () => {
  assert.equal(DEFAULT_SHARE.timePerSlide, true);
  assert.equal(shareBody({ ...DEFAULT_SHARE, investor: '5' }, DECK).time_per_slide, true);
  assert.equal(shareBody({ ...DEFAULT_SHARE, investor: '5', timePerSlide: false }, DECK).time_per_slide, false);
  const v = await mount(h(ShareDialog, { projectId: 5, deck: DECK, onClose() {} }), {
    'GET /api/decks/6/investor-links': () => response({ links: [] }),
    'GET /api/cycles/raise/modules/pitch-deck/form-options': () => response({ prospects: [{ value: 7, label: '[Pat Partner]' }] }),
  });
  try {
    assert.equal(v.props('pitch-share-time-per-slide').checked, true);
    assert.ok(!v.text().includes(OFF_KEEPS));
    await v.toggle('pitch-share-time-per-slide', false);
    assert.ok(v.text().includes(OFF_KEEPS));
  } finally { await v.close(); }
});
