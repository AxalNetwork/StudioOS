/**
 * D6683 (#6683) — the wizard's rule no longer sends a lowest-cost founder to
 * Estonia, and a card with no recorded cost or timeline shows none.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporate_truth_6683.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jurisdictionCard, recommend } from '../src/pages/incorporate/incorporateModel.js';

test('recommend: the lowest-cost answer is not a route to Estonia', () => {
  assert.notEqual(recommend({ minimalCost: 'yes' }), 'ee_oy');
  assert.notEqual(recommend({ minimalCost: 'yes', raisingVc: 'no' }), 'ee_oy');
  assert.notEqual(recommend({ minimalCost: 'yes', entityPref: 'llc' }), 'ee_oy');
  assert.equal(recommend({ minimalCost: 'yes' }), 'us_de_ccorp');
  assert.equal(recommend({ minimalCost: 'yes', entityPref: 'llc' }), 'us_de_llc');
  assert.equal(recommend({ minimalCost: 'yes', region: 'apac' }), 'sg_pte');
});

test('a card with null cost and time reads none, never a zero', () => {
  const c = jurisdictionCard({ id: 'ee_oy', label: 'Estonia OÜ (e-Residency)', est_cost_usd: null, time_to_form_days: null, pros: [], cons: ['Need e-Residency first'] });
  assert.equal(c.cost, null);
  assert.equal(c.timeline, null);
  assert.deepEqual(c.pros, []);
});
