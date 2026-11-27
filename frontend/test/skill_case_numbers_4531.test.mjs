// #4531: a golden case's number assertions survive the HQ case editor
// unchanged. The editor does not edit them; saving a case keeps them, and an
// unchanged case with numbers keeps its uid (and so its results).
import test from 'node:test';
import assert from 'node:assert/strict';
import { caseToForm, formToCase } from '../src/pages/hq/aiAgents/skillLifecycleModel.js';

const NUMBERS = [{ metric: 'DPI', value: 0.2, unit: 'x', tolerance: 0.005 }];
const saved = {
  uid: 'c'.repeat(32), name: 'Fund metrics',
  input: { records: { 'raise.records': { dpi: 0.2 } } },
  expect: { output: 'brief', must_include: ['DPI'], must_say_not_recorded: [], must_not_include: [], numbers: NUMBERS },
};

test('an unchanged case with numbers keeps its uid and its numbers', () => {
  const r = formToCase(caseToForm(saved));
  assert.equal(r.ok, true);
  assert.equal(r.value.uid, saved.uid);
  assert.deepEqual(r.value.expect.numbers, NUMBERS);
});

test('an edited case keeps its numbers; a case with only numbers is still a case', () => {
  const edited = formToCase({ ...caseToForm(saved), must_include: 'DPI\nRVPI' });
  assert.equal(edited.ok, true);
  assert.equal(edited.value.uid, undefined, 'a changed case is a new case');
  assert.deepEqual(edited.value.expect.numbers, NUMBERS);
  const only = formToCase({ ...caseToForm(saved), must_include: '' });
  assert.equal(only.ok, true);
});

test('a case without numbers is sent without a numbers key, as before', () => {
  const plain = { ...saved, expect: { ...saved.expect, numbers: undefined } };
  const r = formToCase(caseToForm(plain));
  assert.equal('numbers' in r.value.expect, false);
});
