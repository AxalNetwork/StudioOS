/**
 * Archetype illustration sex — parse Settings / advisor answers and
 * fall back to pronouns without guessing on they/them or mixed sets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArchetypeSex,
  sexFromPronouns,
  resolveArchetypeSex,
} from '../src/services/archetypePresentation.ts';

test('parseArchetypeSex accepts advisor options and Settings values', () => {
  assert.equal(parseArchetypeSex('A man'), 'm');
  assert.equal(parseArchetypeSex('A woman'), 'f');
  assert.equal(parseArchetypeSex('Show both for now'), 'both');
  assert.equal(parseArchetypeSex('m'), 'm');
  assert.equal(parseArchetypeSex('female'), 'f');
  assert.equal(parseArchetypeSex('both'), 'both');
  assert.equal(parseArchetypeSex(''), null);
  assert.equal(parseArchetypeSex('nope'), null);
});

test('sexFromPronouns only infers a single binary set', () => {
  assert.equal(sexFromPronouns('he/him'), 'm');
  assert.equal(sexFromPronouns('He/Him/His'), 'm');
  assert.equal(sexFromPronouns('she/her'), 'f');
  assert.equal(sexFromPronouns('they/them'), null);
  assert.equal(sexFromPronouns('he/she'), null);
  assert.equal(sexFromPronouns('she/he'), null);
  assert.equal(sexFromPronouns(''), null);
  assert.equal(sexFromPronouns(null), null);
});

test('resolveArchetypeSex: explicit wins, then pronouns, else both', () => {
  assert.equal(resolveArchetypeSex('f', 'he/him'), 'f');
  assert.equal(resolveArchetypeSex(null, 'he/him'), 'm');
  assert.equal(resolveArchetypeSex(null, 'she/her'), 'f');
  assert.equal(resolveArchetypeSex(null, 'they/them'), 'both');
  assert.equal(resolveArchetypeSex(null, null), 'both');
  assert.equal(resolveArchetypeSex('both', 'she/her'), 'both');
});
