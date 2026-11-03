// D4181 (#4181, lr17): the studio's per-video analytics Sheet.
//   - the words: Views, Completion rate, Median watch time; "Not enough views to show" with nothing
//     else under five viewers; an unavailable figure reads its reason, never 0; the curve's 20 bars,
//     chapter markers, the biggest drop, and the views with no recorded position;
//   - the table: "Analytics" on a video's row only, never a reading's or a course's;
//   - mounted: the Sheet reads `/api/admin/learning/items/:uid/analytics` and draws what it says;
//     no member is named.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_analytics_4181.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { NOT_ENOUGH, NOT_RECORDED, analyticsView, hasAnalytics } from '../src/pages/learning/videoAnalyticsModel.js';
import StudioContentTable from '../src/pages/learning/StudioContentTable.jsx';
import VideoAnalyticsSheet from '../src/pages/learning/VideoAnalyticsSheet.jsx';

const h = React.createElement;
/** Synthetic only. */
const BARS = Array.from({ length: 20 }, (_, b) => ({ start_seconds: b * 30, end_seconds: (b + 1) * 30, still_watching_pct: b < 11 ? 100 - b * 3 : 44 }));
const REPLY = {
  item: { uid: 'vid-1', title: 'Synthetic pricing', duration_seconds: 600 },
  analytics: {
    enough: true, views: 10, completion_pct: 40,
    median_watch_seconds: { available: true, value: 320 },
    drop_off: { available: true, value: { buckets: BARS, biggest_drop: { at_seconds: 330, points: 23, chapter: 'The script' }, viewers: 9, unrecorded: 1 } },
    chapters: [{ start_seconds: 0, title: 'Opening' }, { start_seconds: 300, title: 'The script' }],
  },
};

test('D4181: the view — tiles, the curve, its markers, the biggest drop and the unrecorded views', () => {
  const v = analyticsView(REPLY);
  assert.equal(v.enough, true);
  assert.deepEqual(v.tiles.map((t) => [t.label, t.value]), [['Views', '10'], ['Completion rate', '40%'], ['Median watch time', '05:20']]);
  assert.equal(v.curve.bars.length, 20);
  assert.equal(v.curve.bars[11].label, '05:30–06:00: 44% still watching');
  assert.deepEqual(v.curve.markers.map((m) => [m.title, m.at, m.pct]), [['Opening', '00:00', 0], ['The script', '05:00', 50]]);
  assert.equal(v.curve.biggest, 'Biggest drop at 05:30 The script: 23 points.');
  assert.equal(v.curve.unrecorded, `1 view without a recorded position: ${NOT_RECORDED}`);
});

test('D4181: under five viewers, nothing but "Not enough views to show"; an absent figure reads its reason, never 0', () => {
  const few = analyticsView({ item: { title: 'x' }, analytics: { enough: false, reason: NOT_ENOUGH, min_viewers: 5 } });
  assert.deepEqual(few, { title: 'x', enough: false, line: NOT_ENOUGH });
  const noLength = analyticsView({ ...REPLY, analytics: { ...REPLY.analytics, median_watch_seconds: { available: false, reason: NOT_RECORDED }, drop_off: { available: false, reason: NOT_RECORDED } } });
  assert.deepEqual(noLength.tiles[2], { key: 'median', label: 'Median watch time', value: null, reason: NOT_RECORDED });
  assert.equal(noLength.curve, null);
  assert.equal(noLength.curveReason, NOT_RECORDED);
  assert.equal(analyticsView(null).enough, false, 'a reply in another shape shows no figure');
});

test('D4181: "Analytics" is on a video\'s row only', () => {
  assert.deepEqual([hasAnalytics({ kind: 'video', uid: 'v' }), hasAnalytics({ kind: 'reading', uid: 'r' }), hasAnalytics({ kind: 'course', uid: 'c' })], [true, false, false]);
  const rows = [
    { kind: 'video', uid: 'vid-1', title: 'Synthetic pricing', status: 'published', visibility: 'open', programs: null, updated_at: '2026-11-01' },
    { kind: 'reading', uid: 'read-1', title: 'Synthetic reading', status: 'published', visibility: 'open', programs: null, updated_at: '2026-11-01' },
  ];
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(StudioContentTable, { status: 'ready', rows, onAnalytics: () => {} })));
  assert.match(html, /data-testid="studio-analytics-open-vid-1"/);
  assert.doesNotMatch(html, /studio-analytics-open-read-1/);
  const without = renderToStaticMarkup(h(MemoryRouter, null, h(StudioContentTable, { status: 'ready', rows })));
  assert.doesNotMatch(without, /studio-analytics-open-/, 'no action without a handler');
});

async function mount(read) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(VideoAnalyticsSheet, { uid: 'vid-1', fallbackTitle: 'Synthetic pricing', onClose: () => {}, read }))));
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '').replace(/\s+/g, ' ').trim();
  return { by, text, async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); } };
}

test('D4181: mounted, the Sheet reads the route and draws what it says; no member is named', async () => {
  const asked = [];
  const m = await mount(async (uid) => { asked.push(uid); return REPLY; });
  try {
    assert.deepEqual(asked, ['vid-1']);
    assert.match(m.text(m.by('studio-analytics')), /Synthetic pricing · analytics/);
    assert.equal(m.text(m.by('studio-analytics-views')), 'Views 10');
    assert.equal(m.text(m.by('studio-analytics-completion')), 'Completion rate 40%');
    assert.equal(m.text(m.by('studio-analytics-median')), 'Median watch time 05:20');
    assert.equal(m.by('studio-analytics-bars').childNodes.length, 20);
    assert.equal(m.text(m.by('studio-analytics-biggest')), 'Biggest drop at 05:30 The script: 23 points.');
    assert.match(m.text(m.by('studio-analytics-chapters')), /00:00 Opening 05:00 The script/);
    assert.doesNotMatch(m.text(m.by('studio-analytics')), /@|user/i, 'no member named');
  } finally { await m.close(); }
  const few = await mount(async () => ({ item: REPLY.item, analytics: { enough: false, reason: NOT_ENOUGH, min_viewers: 5 } }));
  try {
    assert.equal(few.text(few.by('studio-analytics-not-enough')), NOT_ENOUGH);
    assert.equal(few.by('studio-analytics-tiles'), undefined, 'no figure under five viewers');
    assert.equal(few.by('studio-analytics-curve'), undefined);
  } finally { await few.close(); }
  const bad = await mount(async () => { throw new Error('synthetic failure'); });
  try {
    assert.match(bad.text(bad.by('studio-analytics-error')), /could not be read\. This is not a claim that nobody watched\./);
  } finally { await bad.close(); }
});
