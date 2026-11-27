import test from 'node:test';
import assert from 'node:assert/strict';
import { deckSaveFailure, ndaFailure, newDeckFailure, reviewFailure } from '../src/pages/raise/pitch/pitchSafeErrors.js';

const internal = [
  Object.assign(new Error('D1_ERROR: no such column at storageUsage.ts:42:9'), { status: 500 }),
  new TypeError('Failed to fetch'),
  Object.assign(new Error('SQLITE_CONSTRAINT stack /worker/index.ts:12:3'), { status: 503 }),
];

test('pitch writes never show internal errors', () => {
  const flows = [
    [deckSaveFailure, 'The deck could not be saved.'],
    [reviewFailure, 'The review could not be run. Nothing was saved. Try again.'],
    [ndaFailure, 'The NDA could not be recorded. Try again.'],
    [newDeckFailure, 'That did not work. Nothing was changed.'],
  ];
  for (const [failure, fallback] of flows) {
    for (const error of internal) {
      const line = failure(error);
      assert.equal(line, fallback);
      assert.doesNotMatch(line, /D1_ERROR|SQLITE|Failed to fetch|storageUsage|worker\/index/i);
    }
  }
});

test('pitch code-driven 402 and feature-off 503 use approved copy', () => {
  assert.equal(newDeckFailure({ status: 402, code: 'budget_user_month', message: 'provider secret' }), 'Your AI balance cannot cover this. Add tokens, then try again.');
  assert.equal(reviewFailure({ status: 503, code: 'review_off', message: 'provider secret' }), 'The review could not be run. Nothing was saved. Try again.');
});
