/**
 * D4675 part 2 (#4675) — the DSR clock as the owner decided it on 2026-11-10:
 * Q1 = B, one calendar month from receipt to the end of that UTC day; Q2 = B,
 * overdue from the deadline instant.
 *
 * The Worker computes `deadline_at`, `days_left` and `overdue`
 * (cloudflare-worker/test/dsr_lifecycle_d4675.test.ts pins the arithmetic).
 * These tests pin what each HQ surface SAYS about it: the rule is named from
 * the payload rather than a hard-coded "30-day" that would now be wrong, the
 * due day reads "due today" rather than "0d left", and the first negative day
 * reads overdue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOverview } from '../src/pages/hq/security/overviewModel.js';
import { remainingOf, openState, dueDayOf } from '../src/pages/hq/security/privacyModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CLOCK = { rule: 'calendar_month', label: 'One calendar month from receipt, to the end of that UTC day' };
const row = (days_left, deadline_at = '2026-02-28T23:59:59.999Z') => ({
  id: 1, email: 'subject@example.test', kind: 'erasure', requested_at: '2026-01-31 10:00:00',
  request_id: 7, days_left, deadline_at, overdue: days_left === null ? null : days_left < 0,
});

test('the due day is "due today", the next day is overdue, and nothing reads "0d left" after the deadline', () => {
  assert.equal(remainingOf(1), '1 day');
  assert.equal(remainingOf(0), 'Due today');
  assert.equal(remainingOf(-1), 'Overdue by 1 day');
  assert.equal(openState(row(0)).word, 'Due soon', 'the due day is not yet overdue');
  assert.equal(openState(row(-1)).word, 'Overdue', 'the instant after the due day is overdue');
  assert.equal(remainingOf(null), 'Unknown', 'an unknown clock is not a clock at zero');
  // The end-of-day deadline prints as ITS day in UTC, not the next one.
  assert.equal(dueDayOf('2026-02-28T23:59:59.999Z'), 'Sat 28 Feb 2026');
});

test('the classic list says "due today" on the due day, and names the rule rather than a day count', () => {
  const page = read('frontend/src/pages/hq/SecurityPage.jsx');
  assert.match(page, /d\.days_left === 0 \? 'due today'/, 'the due day reads "0d left" again');
  assert.doesNotMatch(page, /clock_days/, 'a reader still expects a fixed day count');
  assert.match(page, /data\.dsr\?\.clock\?\.label/, 'the zone no longer names the rule from the payload');
});

test('the Overview names the one-month clock; an overdue request is a finding the day after its due day', () => {
  const overview = (rows) => buildOverview({
    overview: { state: 'ready', at: '2026-03-01T10:00:00Z', value: { dsr: { available: true, clock: CLOCK, rows, kinds: [], by_branch: [], branches: { bound: 0, reason: 'r' } } } },
    feed: { state: 'ready', at: '2026-03-01T10:00:00Z', value: { items: [] } },
  });
  const late = overview([row(-1)]);
  const f = late.findings.find((x) => x.id === 'dsr-overdue');
  assert.ok(f, 'a request past its due day is not a finding');
  assert.match(f.detail, /one-month clock from receipt has run out/);
  assert.doesNotMatch(f.detail, /30-day/, 'the Overview still names the retired 30-day clock');
  const onTime = overview([row(0)]);
  assert.equal(onTime.findings.find((x) => x.id === 'dsr-overdue'), undefined, 'the due day itself is not overdue');
  assert.ok(onTime.findings.find((x) => x.id === 'dsr-near'), 'the due day is inside the near window');
});
