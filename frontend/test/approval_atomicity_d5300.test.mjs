/**
 * D5300 — an unconfirmed response must not claim a decision changed nothing.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/approval_atomicity_d5300.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { refusalLine } from '../src/pages/admin/approvals/approvalsModel.js';

test('only a confirmed refusal says nothing changed; transport and 5xx outcomes stay unknown', () => {
  assert.equal(
    refusalLine(Object.assign(new Error('That decision is no longer available.'), { status: 409 })),
    'That decision is no longer available.',
  );
  assert.match(
    refusalLine(Object.assign(new Error('Internal'), { status: 503 })),
    /outcome could not be confirmed/i,
  );
  assert.doesNotMatch(refusalLine(Object.assign(new Error('Internal'), { status: 503 })), /nothing changed/i);
  assert.match(refusalLine(new Error('Network down')), /outcome could not be confirmed/i);
  // Mutation check: restoring the old blanket "Nothing changed" 5xx copy
  // fails both the positive unknown-outcome assertion and this negative one.
});
