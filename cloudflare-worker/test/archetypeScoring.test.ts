/**
 * Task #45 — Archetype scoring engine (pure core) tests.
 *
 * Pins the nearest-centroid classifier so a bank/centroid edit can't silently
 * change how users are classified. No D1 / auth — the DB orchestrator is not
 * exercised here (it's thin plumbing over these pure functions).
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/archetypeScoring.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyArchetype,
  archetypesForPersona,
  narrativeArchetype,
  ARCHETYPE_TRAITS,
} from '../src/services/archetypeScoring.ts';

test('classifyArchetype lands a builder/visionary founder on the Maverick', () => {
  const c = classifyArchetype('founder', { builder: 5, visionary: 4, connector: 2, operator: 2 });
  assert.ok(c);
  assert.equal(c!.slug, 'fo_maverick');
  assert.ok(c!.confidence > 0);
  assert.equal(c!.traits_covered, 4);
});

test('classifyArchetype lands a process-led, visionary investor on the Thesis-Driven Backer', () => {
  const c = classifyArchetype('investor', { visionary: 5, operator: 5, builder: 1, connector: 1 });
  assert.ok(c);
  assert.equal(c!.slug, 'inv_thesis_backer');
});

test('classifyArchetype lands a people-first advisor on the Hands-On Coach', () => {
  const c = classifyArchetype('advisor', { connector: 5, builder: 4, visionary: 2, operator: 3 });
  assert.ok(c);
  assert.equal(c!.slug, 'mt_hands_on_coach');
});

test('coach shares the advisor archetype set', () => {
  assert.deepEqual(
    archetypesForPersona('coach').map((a) => a.slug),
    archetypesForPersona('advisor').map((a) => a.slug),
  );
});

test('no answered traits → null (clean empty state, not a fabricated archetype)', () => {
  assert.equal(classifyArchetype('founder', {}), null);
});

test('confidence rises with coverage: 1 trait < all 4 traits', () => {
  const one = classifyArchetype('founder', { builder: 5 });
  const four = classifyArchetype('founder', { builder: 5, visionary: 4, connector: 2, operator: 2 });
  assert.ok(one);
  assert.ok(four);
  assert.ok(four!.confidence > one!.confidence, 'more traits answered → higher confidence');
});

test('classification is deterministic (ties break by set order)', () => {
  const a = classifyArchetype('partner', { builder: 3, visionary: 3, connector: 3, operator: 3 });
  const b = classifyArchetype('partner', { builder: 3, visionary: 3, connector: 3, operator: 3 });
  assert.deepEqual(a, b);
});

test('every trait axis is a valid ARCHETYPE_TRAIT and there are exactly four', () => {
  assert.equal(ARCHETYPE_TRAITS.length, 4);
  assert.deepEqual([...ARCHETYPE_TRAITS].sort(), ['builder', 'connector', 'operator', 'visionary']);
});

test('narrativeArchetype names the archetype + its confidence', () => {
  const c = classifyArchetype('founder', { builder: 5, visionary: 4, connector: 2, operator: 2 })!;
  const n = narrativeArchetype(c);
  assert.ok(n.includes('Maverick'));
  assert.ok(/%/.test(n));
});
