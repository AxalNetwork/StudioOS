/**
 * D250 — the schedule controls say when a scheduled post will actually go,
 * and a failed scheduled post shows its reason.
 *
 * The helpers are pure and run here; the two consoles' wiring is read as
 * source, because their components load in effects that a static render never
 * runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toLocalInput, scheduledNote, failedNote } from '../src/lib/scheduledPost.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TG = raw('frontend/src/pages/admin/AdminTelegram.jsx');
const X = raw('frontend/src/pages/admin/AdminX.jsx');

test('toLocalInput renders the stored UTC instant in local time, and round-trips', () => {
  // CI runs in UTC, where local and UTC coincide and a helper that returned the
  // UTC clock would pass. A zone with an offset is what makes this a guard.
  const prevTz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
  const iso = '2026-09-24T10:00:00.000Z';
  assert.equal(toLocalInput(iso), '2026-09-24T06:00', 'the input shows the UTC hour, not the local one');
  const local = toLocalInput(iso);
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  // A datetime-local value parses as LOCAL time; it must name the same instant.
  assert.equal(new Date(local).toISOString(), iso);
  assert.equal(toLocalInput('not a time'), '');
  assert.equal(toLocalInput(null), '');
  } finally {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  }
});

test('the scheduled note promises "within a minute", in local time and UTC', () => {
  const n = scheduledNote('2026-09-24T10:00:00.000Z');
  assert.match(n, /^Goes out within a minute of .+ \(2026-09-24 10:00 UTC\), sent by the scheduler\.$/);
  assert.equal(scheduledNote('garbage'), null, 'an unreadable time was given a promise');
});

test('a failed post says it was not sent, with its reason or that none was recorded', () => {
  assert.equal(failedNote('daily_cap_reached: the account had used 50 of its 50 posts today.'),
    'Not sent: daily_cap_reached: the account had used 50 of its 50 posts today.');
  assert.equal(failedNote(''), 'Not sent. No reason was recorded.');
  assert.equal(failedNote(null), 'Not sent. No reason was recorded.');
});

test('Telegram: the composer seeds local time and shows the scheduled and failed notes', () => {
  assert.match(TG, /setScheduleAt\(toLocalInput\(found\?\.scheduled_for\)\)/);
  assert.doesNotMatch(TG, /scheduleAt\.slice\(0, 16\)/, 'the composer shows the UTC hour as local again');
  assert.match(TG, /post\?\.status === 'scheduled' && scheduledNote\(post\.scheduled_for\)/);
  assert.match(TG, /post\?\.status === 'failed' && \(/);
  assert.match(TG, /\{failedNote\(post\.send_error\)\}/);
});

test('X: the schedule prompt defaults to local time and a scheduled post says when it goes', () => {
  assert.match(X, /const def = toLocalInput\(p\.scheduled_for \|\| /);
  assert.doesNotMatch(X, /new Date\(p\.scheduled_for\)\.toISOString\(\)\.slice\(0, 16\)/,
    'the prompt pre-fills the UTC clock under a "local time" label again');
  assert.match(X, /p\.status === 'scheduled' && scheduledNote\(p\.scheduled_for\)/);
});
