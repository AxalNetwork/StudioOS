/**
 * D1434 (#3703, part 2): the HQ change log names the Stripe mode cutover in
 * words. The Worker records it as `stripe_mode_cutover` under the kind `mode`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionWord, whatWord, detailText } from '../src/pages/admin/payments/payModel.js';

test('the cutover reads as words in the change log, never as its code', () => {
  assert.equal(whatWord('mode'), 'Stripe mode');
  assert.equal(actionWord('stripe_mode_cutover'), 'Moved the stored Stripe records to another mode');
});

test('a cutover row says from which mode to which, and how many plans went back to free', () => {
  assert.equal(detailText({ action: 'stripe_mode_cutover', details: { from_mode: 'test', to_mode: 'live', plans_reset: 3 } }),
    'Test to Live · 3 plans back to free');
  assert.equal(detailText({ action: 'stripe_mode_cutover', details: { from_mode: 'test', to_mode: 'live', plans_reset: 1 } }),
    'Test to Live · 1 plan back to free');
  assert.equal(detailText({ action: 'stripe_mode_cutover', details: { from_mode: 'test', to_mode: 'live' } }), 'Test to Live');
  assert.equal(detailText({ action: 'stripe_mode_cutover', details: {} }), null, 'an unrecorded mode is not guessed');
});
