/**
 * Profiling v2 personas — shape, and sanity under today's classifier.
 *
 * The targets must classify to their expected archetype under
 * classifyArchetype (v1 nearest-centroid) before Session 7 changes the
 * engine. A blend's runner-up is its named secondary.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/profiling_v2_personas.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPE_SLUGS_BY_ROLE,
  AXAL_VALUES,
  CLOSE_PAIRS,
  PROFILING_V2_PERSONAS,
  RADAR_AXES,
  ROLES,
  TRAITS,
  VALUE_KEYS_BY_ROLE,
} from './fixtures/profiling_v2_personas.ts';
import { ARCHETYPES, classifyArchetype } from '../src/services/archetypeScoring.ts';

const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 5;

test('sixteen archetypes, four per role, plus one blend per role', () => {
  assert.equal(PROFILING_V2_PERSONAS.length, 20);
  const archetypes = PROFILING_V2_PERSONAS.filter((p) => p.kind === 'archetype');
  const blends = PROFILING_V2_PERSONAS.filter((p) => p.kind === 'blend');
  assert.equal(archetypes.length, 16);
  assert.equal(blends.length, 4);
  for (const role of ROLES) {
    assert.equal(archetypes.filter((p) => p.role === role).length, 4, role);
    assert.equal(blends.filter((p) => p.role === role).length, 1, role);
  }
  const ids = new Set(PROFILING_V2_PERSONAS.map((p) => p.id));
  assert.equal(ids.size, 20);
});

test('every expected slug is one of that role\'s four, and a blend stays inside the role', () => {
  for (const p of PROFILING_V2_PERSONAS) {
    const slugs = ARCHETYPE_SLUGS_BY_ROLE[p.role] as readonly string[];
    assert.ok(slugs.includes(p.expected_slug), `${p.id} expected ${p.expected_slug}`);
    assert.ok(p.email.endsWith('@example.test'), p.email);
    if (p.kind === 'archetype') {
      assert.equal(p.secondary_slug, null, p.id);
    } else {
      assert.ok(p.secondary_slug, `${p.id} names a secondary`);
      assert.notEqual(p.secondary_slug, p.expected_slug, p.id);
      assert.ok(slugs.includes(p.secondary_slug as string), `${p.id} secondary leaves the role`);
    }
  }
});

test('every target number is inside 0–5, and the value keys are that role\'s', () => {
  for (const p of PROFILING_V2_PERSONAS) {
    for (const t of TRAITS) assert.ok(inRange(p.traits[t]), `${p.id} ${t}`);
    for (const axis of RADAR_AXES) assert.ok(inRange(p.skills[axis]), `${p.id} ${axis}`);
    for (const key of AXAL_VALUES) assert.ok(inRange(p.axal[key]), `${p.id} ${key}`);
    const want = [...VALUE_KEYS_BY_ROLE[p.role]].sort();
    const got = Object.keys(p.values).sort();
    assert.deepEqual(got, want, `${p.id} value keys`);
    for (const key of want) assert.ok(inRange(p.values[key]), `${p.id} ${key}`);
  }
});

test('under today\'s classifier each target lands on its expected archetype', () => {
  for (const p of PROFILING_V2_PERSONAS) {
    const result = classifyArchetype(p.role, p.traits);
    assert.ok(result, p.id);
    assert.equal(result.slug, p.expected_slug, p.id);
    if (p.kind === 'blend') assert.equal(result.runner_up_slug, p.secondary_slug, p.id);
  }
});

test('close pairs match the centroids, and the tight pair is the one that needs five items', () => {
  for (const pair of CLOSE_PAIRS) {
    const defs = ARCHETYPES[pair.role];
    const a = defs.find((d) => d.slug === pair.a);
    const b = defs.find((d) => d.slug === pair.b);
    assert.ok(a && b, `${pair.a} ${pair.b}`);
    let sum = 0;
    for (const t of TRAITS) {
      const d = a.centroid[t] - b.centroid[t];
      sum += d * d;
    }
    const distance = Math.round(Math.sqrt(sum) * 100) / 100;
    assert.equal(distance, pair.distance, `${pair.a}–${pair.b}`);
    assert.equal(pair.separating_items, distance < 2 ? 5 : 3, `${pair.a}–${pair.b} items`);
  }
});
