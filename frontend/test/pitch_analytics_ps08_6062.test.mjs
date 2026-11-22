// D6062 (#6062, Pitch Studio v2 PS-08) — investor analytics with four kinds of
// nothing and one investor's journey.
//
//   1. The four kinds (tracking off, unreadable, measured zero, not recorded):
//      each has its own word and sentence, and each has its own test below,
//      on the per-investor figures, the overview figures and the drawn tile.
//   2. A zero is drawn only when it was measured; nothing reads "0 s".
//   3. One investor's journey: the tiles, time per card, the journey's order,
//      and the newer version the link does not open.
//   4. The overview tiles on the daily read, and the grey line of a counted
//      day with no views.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_analytics_ps08_6062.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ViewerAnalyticsSheet from '../src/pages/raise/pitch/ViewerAnalyticsSheet.jsx';
import FigureTile from '../src/pages/raise/pitch/AnalyticsFigure.jsx';
import { OverviewTiles, ViewsPerDay } from '../src/pages/raise/pitch/ShareBoard.jsx';
import {
  ABSENCE, ABSENCE_KINDS, ASK_NOT_REACHED, NO_ASK_CARD, NO_READ_TIME, NOT_OPENED,
  cardRows, investorFigures, journeyRows, newerVersionOf,
} from '../src/pages/raise/pitch/slideAnalyticsModel.js';
import {
  ASK_ZERO, NO_ASK_FUNNEL, NO_TIMED_CARD, OVERVIEW_ZERO, ZERO_DAY_NOTE, overviewFigures, periodWords,
} from '../src/pages/raise/pitch/shareBoardModel.js';

const h = React.createElement;
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const stateOf = (html) => (/data-figure-state="([a-z_]+)"/.exec(html) || [])[1];

const CARDS = [
  { card_uid: 'cover', index: 0, title: '[Cover]', seconds: 18 },
  { card_uid: 'traction', index: 1, title: '[Traction]', seconds: 112 },
  { card_uid: 'market', index: 2, title: '[Market]', seconds: null },
  { card_uid: 'ask', index: 3, title: '[The ask]', seconds: 69 },
];
const LINK = (over = {}) => ({
  deck_id: 6, link_id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]', prospect_id: 7 },
  nda: { state: 'accepted', accepted_at: '2026-11-06 18:40:00' }, status: 'live', withdrawn_at: null, time_per_slide: true,
  views: 3, last_viewed_at: '2026-11-09 07:12:00', read_seconds: 372, cards: CARDS, most_read: CARDS[1], ask_card_uid: 'ask',
  timeline: [
    { kind: 'opened', at: '2026-11-06 18:40:00', view_id: 1 },
    { kind: 'nda_accepted', at: '2026-11-06 18:40:00', view_id: null },
    { kind: 'revisited', at: '2026-11-07 21:10:00', view_id: 2 },
    { kind: 'reached_ask', at: '2026-11-07 21:14:00', view_id: 2 },
    { kind: 'revisited', at: '2026-11-09 07:12:00', view_id: 3 },
  ],
  ...over,
});
const ROW = (over = {}) => ({
  id: 11, investor: LINK().investor, version: { variant: null }, nda: LINK().nda, expires_at: '2026-11-22 10:02:00',
  status: 'live', withdrawn_at: null, time_per_slide: true, created_at: '2026-11-06 10:02:00',
  analytics: { views: 3, last_viewed_at: '2026-11-09 07:12:00', read_seconds: 372 }, ...over,
});
const OFF = { time_per_slide: false, cards: null, most_read: null, read_seconds: null };

test('PS-08 C: four kinds of nothing, each with its own word and its own sentence', () => {
  assert.deepEqual([...ABSENCE_KINDS], ['tracking_off', 'unreadable', 'measured_zero', 'not_recorded']);
  const words = ABSENCE_KINDS.map((k) => ABSENCE[k].word);
  const lines = ABSENCE_KINDS.map((k) => ABSENCE[k].line);
  assert.equal(new Set(words).size, 4, 'four words');
  assert.equal(new Set(lines).size, 4, 'four sentences');
  // Written out, so a changed word fails here. The failed read's screen word is the platform's (D5129).
  assert.deepEqual(words, ['Tracking off', 'Unavailable', 'Measured zero', 'Not recorded']);
  assert.match(ABSENCE.tracking_off.line, /^Visit counts only\. Time per slide is off for this link\. Turn it on for future visits; past visits stay untimed\.$/);
  assert.match(ABSENCE.unreadable.line, /^Views could not be read\. Not zero: the read failed\.$/);
  assert.match(ABSENCE.measured_zero.line, /^Measured: /);
  for (const k of ['tracking_off', 'unreadable', 'not_recorded']) assert.doesNotMatch(ABSENCE[k].line, /\b0\b/, `${k} never says 0`);
});

test('tracking off: time on deck and the ask are Tracking off; the visit count still stands', () => {
  const f = investorFigures(LINK(OFF));
  assert.equal(f.time.kind, 'tracking_off');
  assert.equal(f.ask.kind, 'tracking_off');
  assert.equal(f.time.value, undefined, 'no figure under Tracking off');
  assert.deepEqual([f.visits.kind, f.visits.value, f.visits.sub], ['value', '3', '2 revisits']);
  const html = draw(h(FigureTile, { label: 'Time on deck', fig: f.time }));
  assert.equal(stateOf(html), 'tracking_off');
  assert.match(textOf(html), /Tracking off/);
  assert.doesNotMatch(textOf(html), /Not recorded|Unavailable|Measured zero|\b0\b/);
});

test('unreadable: a failed read makes every figure Unavailable, with Try again, never 0', () => {
  const f = investorFigures(null);
  assert.deepEqual([f.visits.kind, f.time.kind, f.ask.kind], ['unreadable', 'unreadable', 'unreadable']);
  const o = overviewFigures(null);
  assert.deepEqual([o.visits.kind, o.mostRead.kind, o.ask.kind], ['unreadable', 'unreadable', 'unreadable']);
  let retried = 0;
  const html = draw(h(FigureTile, { label: 'Visits', fig: f.visits, onRetry: () => { retried += 1; }, testId: 't' }));
  assert.equal(stateOf(html), 'unreadable');
  assert.match(textOf(html), /Unavailable Views could not be read\. Not zero: the read failed\. Try again/);
  assert.doesNotMatch(textOf(html), /Tracking off|Not recorded|Measured zero|\b0\b/);
});

test('measured zero: a link nobody opened shows 0 visits, measured; time and the ask say Not opened yet, not 0', () => {
  const f = investorFigures(LINK({ views: 0, read_seconds: null, timeline: [], cards: CARDS.map((c) => ({ ...c, seconds: null })), most_read: null }));
  assert.deepEqual([f.visits.kind, f.visits.value], ['measured_zero', '0']);
  assert.deepEqual([f.time.kind, f.time.value], ['none', NOT_OPENED]);
  assert.deepEqual([f.ask.kind, f.ask.value], ['none', NOT_OPENED]);
  // Opened and timed, and the ask card never counted: a measured "Not yet".
  const notYet = investorFigures(LINK({ timeline: LINK().timeline.filter((e) => e.kind !== 'reached_ask') }));
  assert.deepEqual([notYet.ask.kind, notYet.ask.value, notYet.ask.why], ['measured_zero', 'Not yet', ASK_NOT_REACHED]);
  const html = draw(h(FigureTile, { label: 'Visits', fig: f.visits }));
  assert.equal(stateOf(html), 'measured_zero');
  assert.match(textOf(html), /^Visits 0 Measured zero Measured: the link exists and nobody has opened it\.$/);
  const o = overviewFigures({ days: [{ date: '2026-11-01', nda: 0, open: 0, first_nda: 0, first_open: 0 }], funnels: { nda: { sent: 2, opened: 0, reached_ask: 0 }, open: { sent: 0, opened: 0, reached_ask: null } }, dropoff: { current: null } });
  assert.deepEqual([o.visits.kind, o.visits.value, o.visits.why], ['measured_zero', '0', OVERVIEW_ZERO]);
  assert.deepEqual([o.ask.kind, o.ask.value, o.ask.why], ['measured_zero', '0', ASK_ZERO]);
});

test('not recorded: no ask card, no counted reading time, no timed card or ask funnel: Not recorded with why, never 0', () => {
  const noAsk = investorFigures(LINK({ ask_card_uid: null }));
  assert.deepEqual([noAsk.ask.kind, noAsk.ask.why], ['not_recorded', NO_ASK_CARD]);
  const noTime = investorFigures(LINK({ read_seconds: null }));
  assert.deepEqual([noTime.time.kind, noTime.time.why], ['not_recorded', NO_READ_TIME]);
  const o = overviewFigures({ days: [{ date: '2026-11-01', nda: 1, open: 0, first_nda: 1, first_open: 0 }], funnels: { nda: { sent: 1, opened: 1, reached_ask: null }, open: { sent: 0, opened: 0, reached_ask: null } }, dropoff: { current: { version: 7, cards: [{ index: 0, title: 'A', seconds: null }] } } });
  assert.deepEqual([o.mostRead.kind, o.mostRead.why], ['not_recorded', NO_TIMED_CARD]);
  assert.deepEqual([o.ask.kind, o.ask.why], ['not_recorded', NO_ASK_FUNNEL]);
  const html = draw(h(FigureTile, { label: 'Reached the ask', fig: noAsk.ask }));
  assert.equal(stateOf(html), 'not_recorded');
  assert.match(textOf(html), /Not recorded/);
  assert.doesNotMatch(textOf(html), /Tracking off|Unavailable|Measured zero|\b0\b/);
});

test('PS-08 B figures with values: visits and revisits, time on deck, reached the ask by its counted time', () => {
  const f = investorFigures(LINK());
  assert.deepEqual([f.visits.value, f.visits.sub], ['3', '2 revisits']);
  assert.deepEqual([f.time.kind, f.time.value], ['value', '6 m 12 s']);
  assert.deepEqual([f.ask.kind, f.ask.value, f.ask.sub], ['value', 'Yes', 'by 7 Nov · 21:14']);
  assert.equal(investorFigures(LINK({ views: 1 })).visits.sub, 'First visit only');
  const rows = cardRows(LINK());
  assert.deepEqual(rows.map((r) => [r.n, r.label, r.read]), [[1, '18 s', true], [2, '1 m 52 s', true], [3, 'Not read', false], [4, '1 m 9 s', true]]);
});

test('PS-08 B journey: created, the visits in order, withdrawn last; the newer version the link does not open', () => {
  const rows = journeyRows(LINK({ withdrawn_at: '2026-11-10 09:00:00' }), ROW());
  assert.deepEqual(rows.map((r) => r.words), ['Link created', 'Opened', 'Accepted the NDA', 'Revisited', 'Reached the ask', 'Revisited', 'Link withdrawn']);
  assert.equal(rows[0].at, '6 Nov · 10:02');
  assert.deepEqual(journeyRows(LINK({ timeline: [] }), null), []);
  assert.equal(newerVersionOf({ latest: true, since: { version: 7 }, current: { version: 7 } }), null, 'nothing on the current version');
  assert.equal(newerVersionOf(null), null);
  const n = newerVersionOf({ latest: false, since: { version: 6 }, current: { version: 7 } }, '[Pat Partner]');
  assert.equal(n.chip, 'v7 differs');
  assert.equal(n.line, "[Pat Partner]'s link opens v6. v7 is the current version; this link does not show it.");
});

test('PS-08 A overview tiles on the daily read; the period; a counted empty day draws a grey line', () => {
  const data = {
    from: '2026-10-27', to: '2026-11-09',
    days: [
      { date: '2026-11-07', nda: 2, open: 0, first_nda: 1, first_open: 0 },
      { date: '2026-11-08', nda: 0, open: 0, first_nda: 0, first_open: 0 },
      { date: '2026-11-09', nda: 1, open: 1, first_nda: 0, first_open: 1 },
    ],
    funnels: { nda: { sent: 3, opened: 2, reached_ask: 1 }, open: { sent: 1, opened: 1, reached_ask: null } },
    dropoff: { current: { version: 7, cards: [{ index: 0, title: 'Cover', seconds: 30 }, { index: 2, title: 'Traction', seconds: 112 }, { index: 3, title: null, seconds: null }] } },
  };
  const f = overviewFigures(data);
  assert.deepEqual([f.visits.value, f.visits.sub], ['4', '2 first views · 2 revisits']);
  assert.deepEqual([f.mostRead.value, f.mostRead.sub], ['3 · Traction', '1 m 52 s in all on v7 · links with Time per slide on']);
  assert.deepEqual([f.ask.kind, f.ask.value, f.ask.sub], ['value', '1', 'of 2 opened links · counted on links with Time per slide on']);
  assert.equal(periodWords(data), '27 Oct to 9 Nov 2026');
  assert.equal(periodWords({}), null);
  const html = draw(h(OverviewTiles, { data }));
  assert.match(textOf(html), /27 Oct to 9 Nov 2026 Visits 4 .* Most-read card 3 · Traction .* Reached the ask 1 /);
  const chart = draw(h(ViewsPerDay, { days: data.days, empty: false }));
  assert.equal((chart.match(/data-zero-day=""/g) || []).length, 1, 'one counted day with no views');
  assert.ok(textOf(chart).includes(ZERO_DAY_NOTE));
});

// ---------------------------------------------------------------- the mounted sheet

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
async function mountSheet(props, answer) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return answer(calls); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(ViewerAnalyticsSheet, { deck: { id: 6, version: 6 }, row: ROW(), onClose() {}, ...props }))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  return {
    calls: () => calls, by, text: (id) => text(id ? by(id) : document.body).replace(/\s+/g, ' '),
    state: (id) => pr(by(id))['data-figure-state'],
    click: async (id) => { await act(async () => { pr(by(id)).onClick(); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('the sheet draws one investor: version and expiry, the three figures, time per card, the journey and the newer version', async () => {
  const v = await mountSheet({ since: { latest: false, since: { version: 6 }, current: { version: 7 } }, changes: 'Changes since v6 (now v7): ARR $1 → $2' }, () => response(LINK()));
  try {
    assert.match(v.text('viewer-analytics-version'), /v6 Link expires 22 Nov 2026/);
    assert.deepEqual(['viewer-analytics-visits', 'viewer-analytics-time', 'viewer-analytics-ask'].map(v.state), ['value', 'value', 'value']);
    assert.match(v.text('viewer-analytics-ask'), /Yes by 7 Nov · 21:14/);
    assert.match(v.text('viewer-analytics-bar-market'), /3 · \[Market\] Not read/);
    assert.ok(v.by('viewer-analytics-step-created') && v.by('viewer-analytics-step-reached_ask'));
    assert.match(v.text('viewer-analytics-newer'), /v7 differs .*link opens v6\..*Changes since v6/);
    assert.match(v.text(), /It does not say anyone is reading now\./, 'no inference of live viewer activity');
    assert.doesNotMatch(v.text(), /\b0 s\b|Reaction/, 'no 0 seconds, and no reactions row (proposal 9)');
  } finally { await v.close(); }
});

test('the sheet: Tracking off draws no bars; a failed read draws Unavailable with Try again, then the figures', async () => {
  const off = await mountSheet({}, () => response(LINK(OFF)));
  try {
    assert.equal(off.state('viewer-analytics-consent-off'), 'tracking_off');
    assert.equal(off.state('viewer-analytics-time'), 'tracking_off');
    assert.ok(!off.by('viewer-analytics-bars'));
    assert.equal(off.state('viewer-analytics-visits'), 'value');
  } finally { await off.close(); }
  const bad = await mountSheet({ since: { latest: false, since: { version: 6 }, current: { version: 7 } } }, (n) => (n === 1 ? response({ error: 'x' }, 500) : response(LINK())));
  try {
    assert.equal(bad.state('viewer-analytics-unreadable'), 'unreadable');
    assert.ok(!bad.by('viewer-analytics-tiles'), 'no tiles, so no 0, on a failed read');
    assert.ok(!bad.by('viewer-analytics-newer'));
    await bad.click('viewer-analytics-retry');
    assert.equal(bad.calls(), 2);
    assert.equal(bad.state('viewer-analytics-visits'), 'value');
  } finally { await bad.close(); }
});
