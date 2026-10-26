/**
 * #2441 — the cap table's integrity fixes. D1029 (#2866) deleted the old
 * simulator and the variants page whose handlers the rest of this file read;
 * the form they shared lives in the Cap table tool (`scenariosModel.js`), and
 * its rule stays pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputsFromDraft, draftFromScenario } from '../src/pages/raise/captable/scenariosModel.js';

test('blank option pool is omitted; explicit zero remains explicit', () => {
  const draft = draftFromScenario({ name: 'Synthetic', inputs: { founders: [], safes: [], rounds: [] } });
  draft.option_pool_pct = '';
  assert.equal('option_pool_pct' in inputsFromDraft(draft).inputs, false);
  draft.option_pool_pct = '0'; assert.equal(inputsFromDraft(draft).inputs.option_pool_pct, 0);
});
