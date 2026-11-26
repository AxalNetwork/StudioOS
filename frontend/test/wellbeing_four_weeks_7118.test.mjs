/**
 * D7118 part 3 (#7118, canvas `Wellness Member Home`, WLM-03W): "Your last four weeks, in words" on This week. The
 * member's own numbers for the four weeks ending this one; a week without a reflection, or a question left blank,
 * reads "— no entry", never 0; a reflection that could not be read says so. Sample data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/wellbeing_four_weeks_7118.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FOUR_WEEKS_FOOT, NO_ENTRY, UNREAD, fourWeekTable, lastFourWeeks } from '../src/pages/wellbeing/reflectionsModel.js';
import { FourWeeksTable } from '../src/pages/wellbeing/Reflections.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const week = (start, scores, over = {}) => ({ uid: `w-${start}`, cadence: 'week', period_start: start, scores, readable: true, ...over });

test('the four weeks are the four Mondays ending this one, oldest first, across a month and a year end', () => {
  assert.deepEqual(lastFourWeeks('2026-11-16'), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
  // Mutation checked: [21, 14, 7, 0] as [28, 21, 14, 7] → this week is left out.
  assert.deepEqual(lastFourWeeks('2027-01-04'), ['2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04']);
  assert.deepEqual(lastFourWeeks('not a date'), []);
});

test('the canvas: Sleep and Energy over 26 Oct to 16 Nov, the week of 9 Nov with no entry, never 0', () => {
  const t = fourWeekTable('2026-11-16', [
    week('2026-11-16', { sleep: 4, energy: 3 }),
    week('2026-10-26', { sleep: 3, energy: 2 }),
    week('2026-11-02', { sleep: 4, energy: 3 }),
  ]);
  assert.deepEqual(t.columns.map((c) => c.label), ['26 Oct', '2 Nov', '9 Nov', '16 Nov']);
  assert.deepEqual(t.rows.map((r) => r.label), ['Sleep', 'Energy'], 'only questions answered, in the canvas’s order');
  assert.deepEqual(t.rows[0].cells.map((c) => c.text), ['3', '4', NO_ENTRY, '4']);
  assert.deepEqual(t.rows[1].cells.map((c) => c.text), ['2', '3', NO_ENTRY, '3']);
  const out = renderToStaticMarkup(h(FourWeeksTable, { table: t }));
  assert.match(out, /<th scope="col"[^>]*>26 Oct<\/th>/);
  assert.match(out, /— no entry/);
  assert.doesNotMatch(out, />0</, 'a blank is never drawn as 0');
  assert.ok(out.includes(FOUR_WEEKS_FOOT), 'the footnote says blanks are not zeros');
});

test('a question left blank in a saved week is no entry; a week outside the four, or another cadence, is ignored', () => {
  const t = fourWeekTable('2026-11-16', [
    week('2026-11-16', { stress: 3 }),
    week('2026-11-09', { stress: 1, sleep: 2 }),
    week('2026-10-19', { support: 5 }),
    { ...week('2026-11-02', { decisions: 4 }), cadence: 'month' },
  ]);
  assert.deepEqual(t.rows.map((r) => r.key), ['stress', 'sleep'], 'support was answered only outside the window; decisions is not a week');
  assert.deepEqual(t.rows[0].cells.map((c) => c.text), [NO_ENTRY, NO_ENTRY, '1', '3']);
  assert.deepEqual(t.rows[1].cells.map((c) => c.text), [NO_ENTRY, NO_ENTRY, '2', NO_ENTRY]);
});

test('an unreadable week says so instead of looking blank; nothing answered at all says so', () => {
  const t = fourWeekTable('2026-11-16', [week('2026-11-16', { energy: 3 }), week('2026-11-09', null, { readable: false })]);
  // Mutation checked: the readable check dropped from `cell` → the unreadable week reads no entry.
  assert.deepEqual(t.rows[0].cells.map((c) => c.text), [NO_ENTRY, NO_ENTRY, UNREAD, '3']);
  assert.equal(fourWeekTable('2026-11-16', []), null);
  assert.equal(fourWeekTable('2026-11-16', [week('2026-11-16', {})]), null, 'a saved week with no scores is nothing answered');
  assert.match(renderToStaticMarkup(h(FourWeeksTable, { table: null })), /Nothing answered in the last four weeks\./);
});

test('wiring: This week draws the table from its own read of saved weeks, laid on this week’s start', () => {
  const src = read('frontend/src/pages/wellbeing/Reflections.jsx');
  assert.match(src, /wellbeingReflectionsApi\.history\('week', 8\)/);
  assert.match(src, /cadence === 'week' \? <FourWeeks currentStart=\{slot\.period_start\} version=\{version\} \/> : null/);
  assert.match(src, /Your last four weeks couldn’t be read\. They are unchanged\./, 'a failed read says so, never an empty table');
});
