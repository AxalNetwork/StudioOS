/**
 * D5204 (#5204): an all-day event belongs to a calendar date; coverage is the server's count.
 *
 * `new Date('2026-11-09')` is UTC midnight, so read in a zone west of UTC it is the evening BEFORE. The page
 * grouped every item that way, so a Google all-day event on the 9th was drawn on the 8th in Los Angeles and on
 * the 9th in Tokyo, from one row. And "26 of 28 sources answered" counted `KINDS.length` from this page, which
 * includes sources the member hid, sources their role never had and providers they have not connected.
 *
 *   · an all-day row lands on its stated date in every supported zone, and across a DST change;
 *   · a timed row still lands on its own local day, which is the behaviour that was always right;
 *   · the exclusive end date survives, and is turned inclusive only to be shown;
 *   · the page's coverage sentence and banner counts come from the server, never from a constant here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allDayLastDate, byDay, dayKeyOf, isAllDay } from '../src/pages/calendarGrid.js';

/** The zones the issue names, plus one DST transition in each hemisphere's direction. */
const ZONES = ['Europe/Istanbul', 'Europe/Lisbon', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Niue'];

/** Runs `fn` as if the machine were in `zone`. node reads TZ per `Date` construction, so this is enough. */
function inZone(zone, fn) {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

const allDay = (date, endExclusive) => ({
  id: 'external_google:g1', kind: 'external_google', title: 'All-day offsite',
  all_day: true, start_date: date, end_date: endExclusive, start_at: date, end_at: endExclusive,
});
const timed = (iso) => ({ id: 'ic_meeting:1', kind: 'ic_meeting', title: 'IC', start_at: iso, end_at: iso });

test('an all-day event stays on its provider date in every supported zone', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(dayKeyOf(allDay('2026-11-09', '2026-11-10')), '2026-11-09', `${zone}: the stated date moved`);
      // The first and last day of a year are where a UTC round trip shows most plainly.
      assert.equal(dayKeyOf(allDay('2027-01-01', '2027-01-02')), '2027-01-01', `${zone}: new year's day moved`);
      assert.equal(dayKeyOf(allDay('2026-12-31', '2027-01-01')), '2026-12-31', `${zone}: new year's eve moved`);
    });
  }
});

test('a DST transition does not move an all-day event', () => {
  // America/Los_Angeles falls back on 2026-11-01, New York the same day; Lisbon on 2026-10-25.
  for (const [zone, dates] of [
    ['America/Los_Angeles', ['2026-10-31', '2026-11-01', '2026-11-02']],
    ['America/New_York', ['2026-03-07', '2026-03-08', '2026-03-09']],
    ['Europe/Lisbon', ['2026-10-24', '2026-10-25', '2026-10-26']],
  ]) {
    inZone(zone, () => {
      for (const date of dates) {
        assert.equal(dayKeyOf(allDay(date, '2099-01-01')), date, `${zone}: ${date} moved across a DST change`);
      }
    });
  }
});

test('a timed event still lands on its own local day, which is what a zone is for', () => {
  // 2026-11-09T02:30Z is the 9th in UTC and still the 8th in Los Angeles: a timed row follows the member's clock.
  inZone('America/Los_Angeles', () => assert.equal(dayKeyOf(timed('2026-11-09T02:30:00.000Z')), '2026-11-08'));
  inZone('Asia/Tokyo', () => assert.equal(dayKeyOf(timed('2026-11-09T02:30:00.000Z')), '2026-11-09'));
  inZone('Europe/Istanbul', () => assert.equal(dayKeyOf(timed('2026-11-08T23:30:00.000Z')), '2026-11-09'));
  // An unreadable start has no day, and is not guessed.
  assert.equal(dayKeyOf({ start_at: 'not a date' }), null);
  assert.equal(dayKeyOf({}), null);
});

test('byDay places all-day and timed rows together, and counts what it could not place', () => {
  inZone('America/Los_Angeles', () => {
    const { days, unplaced } = byDay([
      allDay('2026-11-09', '2026-11-10'),
      timed('2026-11-09T20:00:00.000Z'), // 12:00 local on the 9th
      { id: 'x', kind: 'manual', title: 'broken', start_at: 'nonsense' },
    ]);
    assert.deepEqual([...days.keys()], ['2026-11-09'], 'the all-day row was placed on another day');
    assert.equal(days.get('2026-11-09').length, 2);
    assert.equal(unplaced, 1);
    // An all-day row sorts above the timed ones, as it always did.
    assert.equal(isAllDay(days.get('2026-11-09')[0]), true);
  });
});

test('the exclusive end date is kept on the wire and shown inclusive', () => {
  // Google states a one-day event on the 9th as 2026-11-09 → 2026-11-10.
  assert.equal(allDayLastDate(allDay('2026-11-09', '2026-11-10')), '2026-11-09');
  // Three days, the 9th to the 11th, ends on the 12th.
  assert.equal(allDayLastDate(allDay('2026-11-09', '2026-11-12')), '2026-11-11');
  // Across a month and a year boundary.
  assert.equal(allDayLastDate(allDay('2026-11-30', '2026-12-01')), '2026-11-30');
  assert.equal(allDayLastDate(allDay('2026-12-31', '2027-01-01')), '2026-12-31');
  // A provider that gave no end, or a nonsense one, is one day: never a range running backwards.
  assert.equal(allDayLastDate(allDay('2026-11-09', undefined)), '2026-11-09');
  assert.equal(allDayLastDate(allDay('2026-11-09', '2026-11-08')), '2026-11-09');
  assert.equal(allDayLastDate(timed('2026-11-09T10:00:00.000Z')), null, 'a timed row has no all-day span');
});

test('an all-day row the Worker did not flag is still read as a date, and a bare date is one', () => {
  // D1208's own readers write a bare date into `start_at` with no flag.
  inZone('America/Los_Angeles', () => {
    assert.equal(dayKeyOf({ kind: 'compliance_due', start_at: '2026-11-09', end_at: '2026-11-10', all_day: true }), '2026-11-09');
  });
});

test('the page reads coverage from the server and no longer counts its own list of kinds', () => {
  const page = readFileSync('frontend/src/pages/CalendarPage.jsx', 'utf8');
  // The denominator and the banner counts come from `attempted`, which the Worker derives from what it read.
  assert.match(page, /const attempted = coverage \? coverage\.attempted : sources\.length;/);
  assert.match(page, /\$\{answered\} of \$\{attempted\} sources answered/);
  assert.match(page, /\{failedSources\.length\} of \{attempted\} sources/);
  // `KINDS.length` must not decide coverage again; it survives only in the comment that explains why.
  const code = page.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('KINDS.length'), 'the page counts its own kinds again');
  // A worker that sends no coverage is not read as complete.
  assert.match(page, /source coverage not reported/);
  // The truncation disclosure says the issue's words, and is drawn ON the flag rather than left behind a
  // condition that can never be true. What it looks like when rendered is `tests/visual/calendar_degraded_5202`.
  assert.match(page, /partially loaded\.\s*\n?\s*Narrow the date range to see everything\./);
  assert.match(page, /data-testid="cal-truncated"/);
  assert.match(page, /\{truncatedKinds\.length > 0 && \(/, 'the disclosure is not drawn on the truncated flag');
  assert.match(page, /const truncatedKinds = sources\.filter\(\(s\) => s\?\.truncated\)/);
});

test('the Worker derives coverage from the set it attempted', () => {
  const route = readFileSync('cloudflare-worker/src/routes/calendar.ts', 'utf8');
  assert.match(route, /attempted: sources\.length/);
  assert.match(route, /answered: answeredCount/);
  assert.match(route, /hidden: hidden\.length/);
  assert.match(route, /complete: failedCount === 0 && truncatedKinds\.length === 0/);
  assert.match(route, /truncated_kinds: truncatedKinds/);
});
