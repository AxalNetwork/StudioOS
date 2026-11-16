/**
 * D6069 (#6069) — NAR11's "Start from: Pitch deck vN's words": the chip, the
 * note that the deck does not change, and the body New version sends.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_start_from_deck_6069.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, startFromChips } from '../src/pages/cycles/forms.js';
import { newVersionLine } from '../src/pages/raise/narrative/narrativeModel.js';

const saved = [{ value: '2', label: 'v2 · angel' }];

test('the deck chip names the deck version and says the deck does not change; no deck, no chip', () => {
  assert.deepEqual(startFromChips(saved, false, { version: 3 }).map((o) => [o.value, o.label]),
    [['version-2', 'v2 · angel'], ['deck-3', "Pitch deck v3's words"], ['blank', 'Blank']]);
  assert.match(startFromChips([], false, { version: 3 })[0].meta, /The deck does not change\./);
  assert.deepEqual(startFromChips(saved, true, { version: 3 }).map((o) => o.value), ['version-2', 'live', 'deck-3', 'blank']);
  assert.deepEqual(startFromChips(saved, false, null).map((o) => o.value), ['version-2', 'blank']);
  assert.deepEqual(startFromChips(saved, false, { version: 'x' }).map((o) => o.value), ['version-2', 'blank'], 'no deck version, no chip');
});

test('the note: Creates vN, and the pitch deck version does not change', () => {
  assert.equal(newVersionLine({ investor_type: 'seed_fund', start_from: 'deck-3' }, saved), 'Creates v3 for seed funds. Pitch deck v3 does not change.');
  assert.equal(newVersionLine({ investor_type: 'angel', start_from: 'version-2' }, saved), 'Creates v3 for angels. Nothing in v2 changes.');
});

test('the body: start_from deck with its deck version, never based_on_version', () => {
  const form = FORMS.raise['investor-narrative'][0];
  const body = form.toBody({ investor_type: 'angel', start_from: 'deck-3' });
  assert.equal(body.start_from, 'deck');
  assert.equal(body.deck_version, 3);
  assert.equal('based_on_version' in body, false);
  assert.equal('deck_version' in form.toBody({ investor_type: 'angel', start_from: 'version-2' }), false);
  assert.deepEqual(form.fromQuery(new URLSearchParams('start_from=deck-3')), {}, 'only a saved version comes from the address');
});
