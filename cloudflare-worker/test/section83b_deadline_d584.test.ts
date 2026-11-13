/**
 * D584 (#1211) — the 83(b) deadline is computed in one place, and today it is
 * the 30th calendar day after the grant, never rolled.
 *
 * Whether a deadline that lands on a Saturday, Sunday or legal holiday rolls to
 * the next business day is with counsel (D361). Until counsel answers, these
 * tests pin the unrolled date: it is never later than the real deadline.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/section83b_deadline_d584.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { electionDeadline, ELECTION_WINDOW_DAYS } from '../src/services/section83b.ts';

const weekday = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];

test('the window is thirty days', () => {
  assert.equal(ELECTION_WINDOW_DAYS, 30);
});

test('the deadline is the 30th calendar day on a weekday, a weekend, a holiday and across a year end', () => {
  const CASES: Array<[string, string, string, string]> = [
    // grant,       deadline,     its day, what the case is
    ['2026-06-01', '2026-07-01', 'Wed', 'a weekday'],
    ['2026-09-03', '2026-10-03', 'Sat', 'a Saturday: not rolled to Monday'],
    ['2026-09-04', '2026-10-04', 'Sun', 'a Sunday: not rolled to Monday'],
    ['2026-11-25', '2026-12-25', 'Fri', 'Christmas Day: not rolled'],
    ['2026-12-15', '2027-01-14', 'Thu', 'across a year end'],
    ['2028-02-01', '2028-03-02', 'Thu', 'across a leap day'],
    ['2027-02-01', '2027-03-03', 'Wed', 'across a February without one'],
  ];
  for (const [grant, deadline, day, what] of CASES) {
    assert.equal(electionDeadline(grant), deadline, what);
    assert.equal(weekday(deadline), day, `the fixture for ${what} is wrong`);
  }
});

test('the create route stores what electionDeadline returns, and nothing else computes it', () => {
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/legal_83b.ts'), 'utf8');
  assert.match(route, /const deadline = electionDeadline\(grantDate\);/);
  assert.doesNotMatch(route, /addDaysISO\(/, 'the route computes a deadline of its own again');
});
