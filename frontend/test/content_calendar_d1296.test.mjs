/**
 * D1296 (#3392) — Content queue › Calendar: month and week (ART7, ART8),
 * Move… on every scheduled chip, and nothing scheduled (ART13c). The API is
 * stubbed and every title is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/content_calendar_d1296.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ContentCalendar from '../src/pages/admin/contentQueue/Calendar.jsx';
import {
  alsoThatDay, chipsByDay, monthGrid, moveProblem, nothingScheduled, readRange, sameTimeNote, shiftMonth, weekDays, weekHours, zoned,
} from '../src/pages/admin/contentQueue/calendarModel.js';
import { WAITS } from '../src/pages/admin/contentQueueModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

/* Invented articles across Europe's clock change (Sun 25 Oct 2026, 01:00 UTC). */
const ITEMS = [
  { id: 11, title: '[Before the change]', status: 'approved', stage: 'scheduled', publish_at: '2026-10-24T08:00:00.000Z', goes_out: '2026-10-24T08:00:00.000Z' },
  { id: 12, title: '[After the change]', status: 'approved', stage: 'scheduled', publish_at: '2026-10-26T08:00:00.000Z', goes_out: '2026-10-26T08:00:00.000Z' },
  { id: 13, title: '[Same minute]', status: 'approved', stage: 'scheduled', publish_at: '2026-10-26T08:00:00.000Z', goes_out: '2026-10-26T08:00:00.000Z' },
  { id: 14, title: '[Late at night]', status: 'approved', stage: 'scheduled', publish_at: '2026-10-28T23:30:00.000Z', goes_out: '2026-10-28T23:30:00.000Z' },
  { id: 21, title: '[Went out]', status: 'published', stage: 'published', published_at: '2026-10-05T09:00:00.000Z', goes_out: '2026-10-05T09:00:00.000Z' },
];
const PUBS = { available: true, items: [{ id: 3, title: '[Q3 brief]', published_at: '2026-10-01T10:00:00.000Z' }] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a month across the clock change: each chip keeps its own local time and day', () => {
  const lisbon = chipsByDay(ITEMS, PUBS, 'Europe/Lisbon');
  // 08:00 UTC is 09:00 in summer time and 08:00 after the change.
  assert.equal(lisbon.get('2026-10-24')[0].time, '09:00');
  assert.equal(lisbon.get('2026-10-26')[0].time, '08:00');
  const utc = chipsByDay(ITEMS, PUBS, 'UTC');
  assert.equal(utc.get('2026-10-24')[0].time, '08:00');
  // Mutation checked: place by the UTC day → 23:30 UTC stays on the 28th in Tokyo.
  const tokyo = chipsByDay(ITEMS, PUBS, 'Asia/Tokyo');
  assert.equal(tokyo.get('2026-10-28'), undefined);
  assert.equal(tokyo.get('2026-10-29')[0].title, '[Late at night]');
  assert.equal(tokyo.get('2026-10-29')[0].time, '08:30');
  assert.deepEqual(zoned('2026-10-25T00:30:00Z', 'Europe/Lisbon'), { day: '2026-10-25', time: '01:30', hour: 1 });
  assert.deepEqual(zoned('2026-10-25T01:30:00Z', 'Europe/Lisbon'), { day: '2026-10-25', time: '01:30', hour: 1 }, 'the repeated hour reads as itself, twice');
});

test('chips: Move… on scheduled articles only; Publications read only and switchable', () => {
  const by = chipsByDay(ITEMS, PUBS, 'UTC');
  assert.deepEqual(by.get('2026-10-05').map((c) => [c.kind, c.move]), [['pub', false]]);
  // Mutation checked: move every chip → a published article offers Move….
  assert.deepEqual(by.get('2026-10-24').map((c) => [c.kind, c.move]), [['sch', true]]);
  assert.deepEqual(by.get('2026-10-01').map((c) => [c.kind, c.move, c.title]), [['pn', false, 'Publication · [Q3 brief]']]);
  assert.equal(chipsByDay(ITEMS, PUBS, 'UTC', { showPublications: false }).get('2026-10-01'), undefined);
  assert.equal(chipsByDay(ITEMS, { available: false, reason: 'unreadable' }, 'UTC').get('2026-10-01'), undefined, 'an unread block draws no chip');
  assert.equal(sameTimeNote(by.get('2026-10-26')), '2 at 08:00');
  assert.equal(sameTimeNote(by.get('2026-10-24')), '');
  assert.deepEqual(alsoThatDay(by, '2026-10-26', 12), ['“[Same minute]” at 08:00']);
});

test('the grid, the week and the read range', () => {
  const g = monthGrid({ y: 2026, m: 10 });
  assert.equal(g.length, 6);
  assert.equal(g[0][0].key, '2026-09-28', 'Monday on or before the 1st');
  assert.equal(g[0][3].key, '2026-10-01');
  assert.equal(g[0][0].inMonth, false);
  assert.deepEqual(weekDays('2026-10-21'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  // Mutation checked: read the shown days only → a chip one UTC day away is never read.
  assert.deepEqual(readRange(g.flat().map((d) => d.key)), { from: '2026-09-27', to: '2026-11-09' });
  assert.throws(() => readRange(['2026-01-01', '2026-06-01']), /92 days/);
  assert.deepEqual(shiftMonth({ y: 2026, m: 12 }, 1), { y: 2027, m: 1 });
  assert.deepEqual(shiftMonth({ y: 2026, m: 1 }, -1), { y: 2025, m: 12 });
  const by = chipsByDay(ITEMS, PUBS, 'UTC');
  const hours = weekHours(by, weekDays('2026-10-28'));
  assert.equal(hours[0], 8);
  assert.equal(hours[hours.length - 1], 23, 'a late chip widens the day');
});

test('nothing scheduled, and the time a Move may set', () => {
  const by = chipsByDay(ITEMS, PUBS, 'UTC');
  const oct = monthGrid({ y: 2026, m: 10 }).flat().filter((d) => d.inMonth).map((d) => d.key);
  assert.equal(nothingScheduled(by, oct), false);
  // Mutation checked: count published chips too → a month of past articles reads as scheduled.
  assert.equal(nothingScheduled(by, ['2026-10-05']), true);
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(moveProblem('2026-10-21T11:00:00Z', now), 'Pick a time in the future.');
  assert.equal(moveProblem('2027-12-01T09:00:00Z', now), 'Pick a time within a year.');
  assert.equal(moveProblem(null, now), 'Pick a date and a time.');
  assert.equal(moveProblem('2026-10-30T09:00:00Z', now), null);
  assert.equal(WAITS.calendar, undefined, 'Calendar no longer waits');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stub({ items = ITEMS, publications = PUBS, ready = [{ id: 31, title: '[Ready one]', author_name: '[Author A]', status: 'approved', stage: 'ready' }], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    api: {
      queue: async (q) => {
        calls.push(['queue', q]);
        if (fail && q.stage === 'calendar') throw Object.assign(new Error('x'), { status: 503 });
        return q.stage === 'ready' ? { items: ready, total: ready.length } : { items, publications, total: items.length };
      },
      schedule: async (id, at) => { calls.push(['schedule', id, at]); return { ok: true }; },
    },
  };
}

async function mount(api, { zone = 'UTC' } = {}) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(ContentCalendar, { api, zone, now: Date.parse('2026-10-21T12:00:00Z') }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });

test('ART7 mounted: October reads its range, chips sit on their days, the ready list offers Schedule…', async () => {
  const s = stub();
  const w = await mount(s.api, { zone: 'Europe/Lisbon' });
  try {
    assert.equal(text(byId(w.container, 'calendar-title')), 'October 2026');
    assert.match(text(byId(w.container, 'calendar-zone')), /Times in Europe\/Lisbon/);
    const q = s.calls.find((c) => c[0] === 'queue' && c[1].stage === 'calendar')[1];
    assert.deepEqual([q.from, q.to], ['2026-09-27', '2026-11-09']);
    assert.match(text(byId(w.container, 'calendar-day-2026-10-24')), /09:00 \[Before the change\]/);
    assert.match(text(byId(w.container, 'calendar-day-2026-10-26')), /08:00 \[After the change\]/);
    assert.equal(text(byId(w.container, 'calendar-note-2026-10-26')), '2 at 08:00');
    assert.ok(byId(w.container, 'calendar-move-11'));
    assert.equal(byId(w.container, 'calendar-move-21'), undefined, 'a published article does not move');
    assert.ok(byId(w.container, 'calendar-schedule-31'));
  } finally { await w.done(); }
});

test('ART8 mounted: Move… opens the dialog first, then sends the schedule call', async () => {
  const s = stub();
  const w = await mount(s.api);
  try {
    await click(byId(w.container, 'calendar-move-12'));
    // Mutation checked: Move… calls schedule at once → a write with no dialog.
    assert.ok(!s.calls.some((c) => c[0] === 'schedule'));
    assert.ok(byId(w.container, 'calendar-schedule'));
    assert.match(text(byId(w.container, 'calendar-schedule-now')), /08:00 UTC · Mon 26 Oct 2026/);
    const input = byId(w.container, 'calendar-schedule-input');
    await act(async () => props(input).onChange({ target: { value: '2026-10-26T08:00' } }));
    assert.match(text(byId(w.container, 'calendar-schedule-others')), /“\[Same minute\]” at 08:00/);
    await act(async () => props(input).onChange({ target: { value: '2026-10-20T09:00' } }));
    // Mutation checked: let a past time through → Schedule is pressable for yesterday.
    assert.match(text(byId(w.container, 'calendar-schedule-problem')), /in the future/);
    assert.equal(props(byId(w.container, 'calendar-schedule-confirm')).disabled, true);
    await act(async () => props(input).onChange({ target: { value: '2026-10-30T11:00' } }));
    assert.equal(props(byId(w.container, 'calendar-schedule-confirm')).disabled, false);
    assert.match(text(byId(w.container, 'calendar-schedule-utc')), /11:00 UTC · Fri 30 Oct 2026/);
    await click(byId(w.container, 'calendar-schedule-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'schedule'), ['schedule', 12, '2026-10-30T11:00:00.000Z']);
    await click(byId(w.container, 'calendar-mode-week'));
    assert.ok(byId(w.container, 'calendar-week'));
    assert.match(text(byId(w.container, 'calendar-title')), /Mon 19 Oct – Sun 25 Oct 2026/);
    assert.ok(byId(w.container, 'calendar-slot-2026-10-24-8'));
  } finally { await w.done(); }
});

test('ART13c mounted: nothing scheduled says so; a failed read is never "nothing"', async () => {
  const empty = await mount(stub({ items: [], publications: { available: true, items: [] }, ready: [] }).api);
  try {
    assert.match(text(byId(empty.container, 'calendar-empty')), /Nothing scheduled in October 2026\./);
    assert.match(text(byId(empty.container, 'calendar-empty')), /Approved articles wait on the right/);
    assert.ok(byId(empty.container, 'calendar-ready-none'));
  } finally { await empty.done(); }
  const failed = await mount(stub({ fail: true }).api);
  try {
    // Mutation checked: read a failure as an empty month → "Nothing scheduled" over an unread calendar.
    assert.equal(byId(failed.container, 'calendar-empty'), undefined);
    assert.match(text(byId(failed.container, 'calendar-error')), /could not be read\. That is not the same as nothing scheduled/);
  } finally { await failed.done(); }
});

test('the page draws the calendar on its address; no browser pop-up and dark pairs', () => {
  assert.match(read('frontend/src/pages/admin/ArticlesQueuePage.jsx'), /view\.tab === 'calendar' \? <ContentCalendar api=\{api\} \/>/);
  const src = read('frontend/src/pages/admin/contentQueue/Calendar.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/);
  assert.doesNotMatch(src, /draggable/, 'no drag: Move… is the way');
});
