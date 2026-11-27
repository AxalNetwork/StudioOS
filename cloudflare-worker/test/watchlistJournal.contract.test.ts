/**
 * Task #14 — unit coverage for the pure watchlist/journal helpers that back
 * the contract rewrite: anti-portfolio grading, follow-up reminder due-logic,
 * and tag normalisation. Only import-free (types-only) modules are pulled in so
 * the --experimental-strip-types loader never has to resolve hono/notify.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gradePass, reminderDue, type ProjectSignal } from '../src/services/watchlistGrading.ts';
import { normaliseTags, trimOrNull } from '../src/routes/_t13t14t15_helpers.ts';

test('gradePass: no project link → open', () => {
  assert.equal(gradePass({ exists: false }), 'open');
});

test('gradePass: dead (rejected) project → vindicated', () => {
  const s: ProjectSignal = { exists: true, is_alive: false, latest_health_badge: 'green', latest_score: 95 };
  assert.equal(gradePass(s), 'vindicated');
});

test('gradePass: alive + green + score>=70 → regret', () => {
  const s: ProjectSignal = { exists: true, is_alive: true, latest_health_badge: 'green', latest_score: 80 };
  assert.equal(gradePass(s), 'regret');
});

test('gradePass: alive + green but score<70 → open', () => {
  const s: ProjectSignal = { exists: true, is_alive: true, latest_health_badge: 'green', latest_score: 60 };
  assert.equal(gradePass(s), 'open');
});

test('gradePass: alive but not green → open', () => {
  const s: ProjectSignal = { exists: true, is_alive: true, latest_health_badge: 'yellow', latest_score: 90 };
  assert.equal(gradePass(s), 'open');
});

test('gradePass: alive + green + null score → open (0 default)', () => {
  const s: ProjectSignal = { exists: true, is_alive: true, latest_health_badge: 'green', latest_score: null };
  assert.equal(gradePass(s), 'open');
});

const NOW = new Date('2026-07-07T12:00:00Z');

test('reminderDue: no next_check_at → false', () => {
  assert.equal(reminderDue(null, null, NOW), false);
});

test('reminderDue: future checkpoint → false', () => {
  assert.equal(reminderDue('2026-08-01T00:00:00Z', null, NOW), false);
});

test('reminderDue: past checkpoint, never reminded → true', () => {
  assert.equal(reminderDue('2026-07-01T00:00:00Z', null, NOW), true);
});

test('reminderDue: past checkpoint, already reminded after due → false', () => {
  assert.equal(reminderDue('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', NOW), false);
});

test('reminderDue: reminded before a newer (bumped) checkpoint → true (re-armed)', () => {
  // reminded on 07-02 for the old checkpoint; new checkpoint 07-05 is now due.
  assert.equal(reminderDue('2026-07-05T00:00:00Z', '2026-07-02T00:00:00Z', NOW), true);
});

test('reminderDue: date-only checkpoint in the past → true', () => {
  assert.equal(reminderDue('2026-07-01', null, NOW), true);
});

test('reminderDue: space-separated timestamp is parsed', () => {
  assert.equal(reminderDue('2026-07-01 09:00:00', null, NOW), true);
});

test('reminderDue: unparseable date → false (never fires on garbage)', () => {
  assert.equal(reminderDue('not-a-date', null, NOW), false);
});

test('normaliseTags: CSV string → JSON array', () => {
  assert.equal(normaliseTags('ai, fintech ,  '), '["ai","fintech"]');
});

test('normaliseTags: JSON-array string passes through, trimmed', () => {
  assert.equal(normaliseTags('[" ai ","b2b"]'), '["ai","b2b"]');
});

test('normaliseTags: array input', () => {
  assert.equal(normaliseTags(['x', ' y ', '']), '["x","y"]');
});

test('normaliseTags: null/empty → []', () => {
  assert.equal(normaliseTags(null), '[]');
  assert.equal(normaliseTags(''), '[]');
});

test('normaliseTags: caps at 20 entries', () => {
  const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
  const out = JSON.parse(normaliseTags(many)) as string[];
  assert.equal(out.length, 20);
});

test('trimOrNull: blank → null, trims + caps', () => {
  assert.equal(trimOrNull('   '), null);
  assert.equal(trimOrNull(null), null);
  assert.equal(trimOrNull('  hi  '), 'hi');
  assert.equal(trimOrNull('abcdef', 3), 'abc');
});
