/**
 * D6865 (#6865) — Grow › Feedback's counts strip, a theme's weight and Close
 * the loop (the #6099 canvas, GR-21, GR-23, GR-26, GR-28), and the two client
 * methods they call. Every person, company and amount below is made up.
 *
 * Mutation checks (each made by hand, the suite run, and reverted; each
 * failed at least one test here):
 *   - feedbackLoopModel.js countsStrip: null counts → zeros                → "unreadable counts are not zeros"
 *   - feedbackLoopModel.js rankThemes: sort by name only                    → "themes are ranked by item count"
 *   - feedbackLoopModel.js revenueLines: none → "$0"                        → "no revenue is Not recorded, never $0"
 *   - feedbackLoopModel.js loopRow: 'cannot' rows selectable                → "only Due rows can be chosen"
 *   - feedbackLoopModel.js toldResult: drop the refused lines               → "every refused row is named"
 *   - FeedbackLoop.jsx CloseTheLoop: checkbox on every row                  → "only Due rows can be chosen"
 *   - FeedbackLoop.jsx: render the themes column with no themes (advisor)    → "an advisor sees the counts only"
 *   - cycleWrites.js: feedbackTold method POST → PATCH                      → "the client methods"
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/feedback_loop_6865.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FeedbackLoop, { CloseTheLoop, CountsStrip, WeightCard } from '../src/pages/cycles/FeedbackLoop.jsx';
import { countsStrip, loopRow, peopleLine, rankThemes, revenueLines, toldResult } from '../src/pages/cycles/feedbackLoopModel.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const COUNTS = { items: 41, open_items: 26, themes: 13, shipped_not_told: 5, period: 'all feedback recorded on this venture' };
const WEIGHT = {
  theme: 'Fleet CSV', items: 5, by_status: { open: 0, planned: 1, shipped: 4 }, distinct_people: 4, not_named: 1,
  people: [
    { name: 'Kai Mori', email: 'kai@kite.test', company: 'Kite Systems', record: { uid: 'ca1', audience: 'customer', status: 'active' }, items: 1 },
    { name: 'Tom Ash', email: 'tom@ash.test', company: null, record: null, items: 1 },
  ],
  revenue: { window_days: 60, since: '2026-09-17', by_currency: [{ currency: 'USD', cents: 480000 }], companies_with_revenue: 1, companies_named: 2,
    not_recorded: [{ name: 'Tom Ash', reason: 'No company named on their feedback' }] },
  roadmap_items: [{ id: 1, label: 'Route replay export' }],
  loop: [
    { uid: 'f1', name: 'Kai Mori', has_email: true, status: 'shipped', state: 'due', reason: null },
    { uid: 'f3', name: 'Hanne Vik', has_email: false, status: 'shipped', state: 'told', told_at: '2026-11-03T10:00:00Z', told_via: 'call', reason: null },
    { uid: 'f4', name: 'Tom Ash', has_email: true, status: 'planned', state: 'cannot', reason: 'Not shipped yet' },
    { uid: 'f5', name: null, has_email: false, status: 'shipped', state: 'cannot', reason: 'Did not ask to be told' },
  ],
};

test('the three counts say what they count; unreadable counts are not zeros', () => {
  const c = countsStrip(COUNTS);
  assert.deepEqual(c.tiles.map((t) => `${t.value} ${t.label}`), ['26 open items', '13 themes', '5 shipped and not yet told']);
  assert.equal(c.period, 'Across 41 items: all feedback recorded on this venture');
  const u = countsStrip(null);
  assert.equal(u.state, 'unreadable');
  assert.match(u.line, /not a claim that there is none/);
  const t = text(h(CountsStrip, { counts: null }));
  assert.doesNotMatch(t, /\b0\b/, 'an unreadable read draws no 0');
  assert.match(text(h(CountsStrip, { counts: { ...COUNTS, shipped_not_told: 0 } })), /0 shipped and not yet told/, 'a measured zero is a zero');
});

test('themes are ranked by item count, then by name', () => {
  assert.deepEqual(rankThemes([{ theme: 'B', feedback: 2 }, { theme: 'A', feedback: 2 }, { theme: 'C', feedback: 7 }, null]).map((t) => t.theme), ['C', 'A', 'B']);
  assert.deepEqual(rankThemes(undefined), []);
});

test('the weight names people and revenue per currency; no revenue is Not recorded, never $0; no score', () => {
  assert.equal(peopleLine(WEIGHT), '4 people asked · 1 item names nobody');
  const r = revenueLines(WEIGHT.revenue);
  assert.deepEqual(r.amounts, ['$4,800']);
  assert.equal(r.line, 'Recurring revenue in the last 60 days from 1 of 2 askers’ companies · ledger');
  const none = revenueLines({ window_days: 60, by_currency: [] });
  assert.deepEqual(none.amounts, []);
  assert.match(none.line, /^Not recorded: no recurring revenue/);
  assert.doesNotMatch(none.line, /\$0|0\.00/);
  const t = text(h(WeightCard, { w: WEIGHT }));
  assert.match(t, /Kai Mori Kite Systems Linked · customer/);
  assert.match(t, /Tom Ash No company named Not linked/);
  assert.match(t, /Not recorded · Tom Ash: No company named on their feedback/);
  assert.match(t, /Route replay export/);
  assert.doesNotMatch(t, /score|rank|impact/i);
});

test('only Due rows can be chosen; every other row says why', () => {
  assert.deepEqual(loopRow(WEIGHT.loop[0]), { selectable: true, word: 'Due', detail: 'Email recorded' });
  assert.deepEqual(loopRow(WEIGHT.loop[1]), { selectable: false, word: 'Told', detail: '2026-11-03 · call' });
  assert.deepEqual(loopRow(WEIGHT.loop[2]), { selectable: false, word: 'Not shipped yet', detail: null });
  const html = renderToStaticMarkup(h(CloseTheLoop, { rows: WEIGHT.loop, onMark: async () => ({}) }));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1, 'one checkbox, for the one Due row');
  assert.match(html, /aria-label="Choose Kai Mori"/);
  const t = text(h(CloseTheLoop, { rows: WEIGHT.loop, onMark: async () => ({}) }));
  assert.match(t, /Did not ask to be told/); assert.match(t, /Not shipped yet/);
  assert.match(t, /Axal never messages your customer/);
});

test('the result says how many were told and names every row that was not, and who has no email', () => {
  assert.deepEqual(toldResult({ told_via: 'in_person', told: [{ uid: 'f1', name: 'Kai Mori', mailto: 'mailto:x', no_email: false }, { uid: 'f2', name: 'Lin Park', no_email: true }],
    refused: [{ uid: 'f4', name: 'Tom Ash', reason: 'Not shipped yet' }] }), [
    'Marked 2 people told (in person).',
    'No email recorded for Lin Park: tell them another way.',
    'Tom Ash: Not shipped yet.',
  ]);
});

test('an advisor (no parts.themes) sees the counts only; a writer sees the themes column', () => {
  const ro = text(h(FeedbackLoop, { counts: COUNTS, themes: undefined, projectId: 7, api: {} }));
  assert.match(ro, /26 open items/);
  assert.doesNotMatch(ro, /Themes · by items/);
  const w = text(h(FeedbackLoop, { counts: COUNTS, themes: [{ theme: 'Onboarding', feedback: 1 }, { theme: 'Fleet CSV', feedback: 5 }], projectId: 7, api: {} }));
  assert.match(w, /Themes · by items Fleet CSV 5 Onboarding 1/);
  assert.match(w, /Reading this theme…/);
});

test('the client methods: the weight read and Mark told for several', async () => {
  const calls = [];
  const writes = makeCycleWrites(async (path, init) => { calls.push([path, init?.method ?? 'GET', init?.body ?? null]); return {}; });
  await writes.grow.feedbackWeight(7, 'Fleet CSV & co');
  await writes.grow.feedbackTold(7, ['f1', 'f2'], 'call');
  assert.deepEqual(calls[0], ['/cycles/grow/feedback/weight?project=7&theme=Fleet%20CSV%20%26%20co', 'GET', null]);
  assert.deepEqual(calls[1], ['/cycles/grow/feedback/told', 'POST', JSON.stringify({ project: 7, uids: ['f1', 'f2'], via: 'call' })]);
});
