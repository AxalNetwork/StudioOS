/**
 * The working week a commitment was made in, and the three windows over it.
 *
 * `/build/this-week` (#176 FB1) drew four chips and three of them were `unbuilt`
 * under one reason: a key result carried no week, and nothing recorded a
 * commitment moving from one week to the next. `unbuilt` renders NOTHING, so three
 * quarters of the artboard's filter row was invisible.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. The week arithmetic is wrong in a way
 * nobody notices: an off-by-one Monday puts every commitment in the adjacent week,
 * `Carried only` then shows this week's brand-new work as carried, and no error is
 * raised anywhere. `getUTCDay()` is 0 on SUNDAY, so the offset back to Monday is
 * `(day + 6) % 7` — `day - 1` sends every Sunday forward a day instead of back six,
 * and is right on the other six days out of seven, which is exactly the kind of bug
 * that ships.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { weekStartOf, recentWeeks, weeksOnRecord, weekWindows, type MoveRow } from '../src/services/okrWeeks.ts';

const move = (o: Partial<MoveRow> & { okr_id: number; week_start: string }): MoveRow => ({
  from_status: null, to_status: 'now', moved_at: `${o.week_start}T09:00:00Z`, ...o,
});

// ── the Monday ────────────────────────────────────────────────────────────────

test('every day of one week maps to the same Monday', () => {
  // 2026-09-14 is a Monday; 2026-09-20 the Sunday after it.
  for (const d of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) {
    assert.equal(weekStartOf(d), '2026-09-14', `${d} landed in the wrong week`);
  }
});

test('Sunday belongs to the week that STARTED, not the one about to', () => {
  // THE ASSERTION THE WHOLE FUNCTION EXISTS FOR. `getUTCDay()` is 0 on Sunday, so
  // an offset of `day - 1` is -1 and sends Sunday FORWARD to Monday the 21st — one
  // week too late, on one day in seven.
  assert.equal(weekStartOf('2026-09-20'), '2026-09-14');
  assert.equal(weekStartOf('2026-09-13'), '2026-09-07');
  assert.notEqual(weekStartOf('2026-09-20'), '2026-09-21');
});

test('a week that crosses a month, a year and a leap day still resolves', () => {
  assert.equal(weekStartOf('2026-10-01'), '2026-09-28');
  assert.equal(weekStartOf('2026-01-01'), '2025-12-29');
  // 2024-02-29 is a Thursday; its Monday is the 26th, in the same month.
  assert.equal(weekStartOf('2024-02-29'), '2024-02-26');
  // 2024-03-01 is a Friday; its Monday is 2024-02-26, so the leap day is inside it.
  assert.equal(weekStartOf('2024-03-01'), '2024-02-26');
});

test('a timestamp works as well as a bare date, and neither goes through a parse', () => {
  // The log stores `datetime('now')`, which is `YYYY-MM-DD HH:MM:SS`, and the route
  // passes a bare day. Both have to land in the same week.
  assert.equal(weekStartOf('2026-09-17 14:32:01'), '2026-09-14');
  assert.equal(weekStartOf('2026-09-17T14:32:01Z'), '2026-09-14');
});

test('a malformed date is null rather than the current week', () => {
  // Falling back to "this week" would file an unparseable move into whatever week
  // the request happened in, which is a confident wrong answer in the archive.
  for (const bad of ['', '   ', 'Monday', '2026-9-1', '26-09-14', null as any, undefined as any, '2026-13-01', '2026-09-00']) {
    assert.equal(weekStartOf(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

// ── the window ────────────────────────────────────────────────────────────────

test('recentWeeks counts back from this week, inclusive, newest first', () => {
  assert.deepEqual(recentWeeks('2026-09-17', 4), ['2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24']);
  // From a Sunday it is the same four — the week is the week, whatever day you ask.
  assert.deepEqual(recentWeeks('2026-09-20', 4), ['2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24']);
  assert.deepEqual(recentWeeks('2026-09-17', 1), ['2026-09-14']);
  assert.deepEqual(recentWeeks('2026-09-17', 0), []);
  assert.deepEqual(recentWeeks('nonsense', 4), []);
});

test('recentWeeks crosses a year boundary without inventing a week', () => {
  assert.deepEqual(recentWeeks('2026-01-05', 3), ['2026-01-05', '2025-12-29', '2025-12-22']);
});

test('weeksOnRecord is distinct and newest first', () => {
  const moves = [
    move({ okr_id: 1, week_start: '2026-08-31' }),
    move({ okr_id: 2, week_start: '2026-09-14' }),
    move({ okr_id: 3, week_start: '2026-08-31' }),
  ];
  assert.deepEqual(weeksOnRecord(moves), ['2026-09-14', '2026-08-31']);
});

// ── the three chips ───────────────────────────────────────────────────────────

test('Last 4 keeps a commitment made in any of the last four weeks and drops the fifth', () => {
  const moves = [
    move({ okr_id: 1, week_start: '2026-09-14' }),   // this week
    move({ okr_id: 2, week_start: '2026-08-24' }),   // four weeks back — in
    move({ okr_id: 3, week_start: '2026-08-17' }),   // five weeks back — out
  ];
  const w = weekWindows(moves, [1], '2026-09-17');
  assert.deepEqual([...w.lastFour].sort(), [1, 2]);
  // …and all three are on record under `All weeks`, so the narrower chip is a
  // narrowing rather than a different source.
  assert.deepEqual([...w.everCommitted].sort(), [1, 2, 3]);
});

test('Carried only is committed EARLIER and still in Now — not merely old', () => {
  const moves = [
    move({ okr_id: 1, week_start: '2026-08-31' }),  // committed 2 weeks ago
    move({ okr_id: 2, week_start: '2026-09-14' }),  // committed this week
    move({ okr_id: 3, week_start: '2026-08-24' }),  // committed, then left Now
  ];
  // 1 and 2 are still in Now; 3 is not.
  const w = weekWindows(moves, [1, 2], '2026-09-17');
  // ONLY 1. Number 2 is this week's new work and is not carried; number 3 is old
  // but is no longer a commitment, so calling it carried would report work as
  // outstanding that the founder already moved on from.
  assert.deepEqual(w.carried, [1]);
});

test('an objective recommitted this week after an earlier week still counts as carried', () => {
  // Its EARLIEST move to Now is what decides, not its latest. Reading the latest
  // would make anything touched this week look new — which is precisely how a
  // three-week-old commitment escapes the chip that exists to surface it.
  const moves = [
    move({ okr_id: 1, week_start: '2026-08-31' }),
    move({ okr_id: 1, week_start: '2026-09-14' }),
  ];
  assert.deepEqual(weekWindows(moves, [1], '2026-09-17').carried, [1]);
});

test('a move OUT of Now is not a commitment', () => {
  const moves = [
    move({ okr_id: 1, week_start: '2026-09-07', from_status: 'now', to_status: 'next' }),
    move({ okr_id: 2, week_start: '2026-09-07', from_status: 'next', to_status: 'now' }),
  ];
  const w = weekWindows(moves, [2], '2026-09-17');
  // Only the arrival counts. Counting departures would put every abandoned
  // objective into "Last 4 weeks" as though it had been committed to.
  assert.deepEqual(w.everCommitted, [2]);
  assert.deepEqual(w.lastFour, [2]);
  // But the WEEK is on record either way — something happened on the board in it.
  assert.deepEqual(w.weeks, ['2026-09-07']);
});

test('an objective in Now with no logged move is in no week window', () => {
  // The seam migration 252 refuses to paper over. It is under `This week` — which
  // reads the current column, not the log — and absent from the other three, and
  // the page prints `history_since` so a reader can see why rather than concluding
  // the filter is broken.
  const w = weekWindows([], [7], '2026-09-17');
  assert.deepEqual(w.lastFour, []);
  assert.deepEqual(w.everCommitted, []);
  assert.deepEqual(w.carried, []);
  assert.deepEqual(w.weeks, []);
});

test('an empty log and an empty board produce empty sets rather than throwing', () => {
  const w = weekWindows([], [], '2026-09-17');
  assert.deepEqual(w, { lastFour: [], everCommitted: [], carried: [], weeks: [] });
});

test('an unparseable today does not make everything carried', () => {
  // `thisWeek` is null then, and `first < null` is false for every string — so the
  // carried set is empty rather than everything. Failing closed matters here: the
  // chip's whole job is to single out a few rows, and "all of them" reads as an
  // answer.
  const moves = [move({ okr_id: 1, week_start: '2026-08-31' })];
  assert.deepEqual(weekWindows(moves, [1], 'nonsense').carried, []);
});
