/** D4961 — the save model: what a re-read says about an intent, and the sentence for each outcome. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveIntent, hasIntent, reconcile, failedBeforeWriting, saveLine } from '../src/pages/account/companies/generalFormModel.js';

const file = { name: 'l.png' };
test('saveIntent carries fields, upload and removal together; an empty one is no intent', () => {
  assert.deepEqual(saveIntent({ stage: 'seed' }, { upload: file }), { fields: { stage: 'seed' }, logo: file, remove: false });
  assert.equal(saveIntent({}, { remove: true }).remove, true);
  assert.equal(hasIntent(saveIntent({}, null)), false);
  assert.equal(hasIntent(saveIntent({}, { remove: true })), true);
});

test('reconcile: all, none and some are told apart, so a retry is never blind', () => {
  const before = { logo_url: null, stage: 'idea' };
  const intent = saveIntent({ stage: 'seed' }, { upload: file });
  const stored = '/api/company/nl/logo?v=abc';
  assert.equal(reconcile({ stage: 'seed', logo_url: stored }, intent, before, 'nl').outcome, 'all');
  assert.equal(reconcile({ stage: 'idea', logo_url: null }, intent, before, 'nl').outcome, 'none');
  const some = reconcile({ stage: 'idea', logo_url: stored }, intent, before, 'nl');
  assert.equal(some.outcome, 'some');
  assert.deepEqual(some.fieldsLeft, ['stage']);
  assert.equal(some.logoSaved, true);
  // A logo that was already stored before is not proof the new upload landed.
  assert.equal(reconcile({ stage: 'seed', logo_url: stored }, intent, { logo_url: stored }, 'nl').outcome, 'some');
});

test('only a 4xx proves nothing was written', () => {
  assert.equal(failedBeforeWriting({ status: 400 }), true);
  assert.equal(failedBeforeWriting({ status: 503 }), false);
  assert.equal(failedBeforeWriting(new Error('timeout')), false);
});

test('saveLine never says "not saved" for an unconfirmed outcome', () => {
  assert.match(saveLine('unknown'), /could not confirm/);
  assert.doesNotMatch(saveLine('unknown'), /were not saved/);
  assert.match(saveLine('partly', { result: { fieldsSaved: [], fieldsLeft: ['stage'], logoSaved: true, logoLeft: false } }), /the logo.*Not saved yet: stage/);
});
