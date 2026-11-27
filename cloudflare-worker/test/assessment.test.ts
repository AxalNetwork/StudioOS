/**
 * Task #44 — Gamified Assessment scoring engine.
 *
 * Drives the REAL pure scoring engine (services/assessmentScoring.ts) against
 * the REAL founder_origin_v1 reference seed, loaded from the actual
 * sql/migrations/107_assessment_engine.sql + 108_assessment_play.sql into an
 * in-memory SQLite database. No auth / HTTP — this exercises the deterministic
 * core (the part that must never silently change a user's result):
 *
 *   1. A full founder_origin_v1 playthrough yields all 5 value spectrums in
 *      [-2,2] and a skill vector over the 8 radar axes in [0,5].
 *   2. A spectrum measured by two disagreeing mechanics gets a `contradiction`
 *      flag and halved confidence; an agreeing two-mechanic spectrum keeps
 *      full confidence.
 *   3. Archetype assignment is deterministic and picks the nearest centroid.
 *   4. The integrity HMAC signs + verifies, and any tamper fails verification.
 *   5. levelForXp matches the §6 curve.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/assessment.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  computeAssessment,
  assignArchetype,
  signResult,
  verifyResult,
  canonicalResult,
  levelForXp,
  SKILL_AXIS_SLUGS,
  type ScoringItem,
  type ScoringResponse,
  type ArchetypeDef,
} from '../src/services/assessmentScoring.ts';

// ── Load the real seed into in-memory SQLite ───────────────────────────────
function seedDb(): InstanceType<typeof DatabaseSync> {
  // D1 doesn't enforce FKs; node:sqlite does. Disable so we don't need the full
  // users/value_dimensions/skills graph just to seed the assessment tables.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const f of ['107_assessment_engine.sql', '108_assessment_play.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

function loadItems(db: InstanceType<typeof DatabaseSync>): Map<string, ScoringItem> {
  const rows = db
    .prepare(
      `SELECT i.id, i.slug, i.mechanic, i.options_json, i.measures_json, i.loads_json, i.config_json
         FROM assessment_items i
         JOIN assessment_games g ON g.id = i.game_id
        WHERE g.slug = 'founder_origin_v1'`,
    )
    .all() as any[];
  const map = new Map<string, ScoringItem>();
  for (const r of rows) {
    map.set(r.slug, {
      id: Number(r.id),
      slug: r.slug,
      mechanic: r.mechanic,
      options: JSON.parse(r.options_json),
      measures: JSON.parse(r.measures_json),
      loads: JSON.parse(r.loads_json),
      config: JSON.parse(r.config_json),
    });
  }
  return map;
}

function loadArchetypes(db: InstanceType<typeof DatabaseSync>): ArchetypeDef[] {
  const rows = db
    .prepare(
      `SELECT a.slug, a.label, a.badge_slug, a.centroid_json, a.display_order
         FROM assessment_archetypes a
         JOIN assessment_games g ON g.id = a.game_id
        WHERE g.slug = 'founder_origin_v1' ORDER BY a.display_order, a.id`,
    )
    .all() as any[];
  return rows.map((a) => ({
    slug: a.slug,
    label: a.label,
    badge_slug: a.badge_slug,
    display_order: Number(a.display_order),
    centroid: JSON.parse(a.centroid_json),
  }));
}

// A deliberate "Rocketeer" playthrough: high speed/risk/growth, mission split
// (so it contradicts), modest autonomy. fo_risk_sjt is intentionally skipped so
// risk is single-mechanic (no seniority product floor) — keeping product low so
// the Maverick centroid (product-heavy) stays farther than Rocketeer.
function rocketeerResponses(items: Map<string, ScoringItem>): ScoringResponse[] {
  const r = (slug: string, response: any, extra: Partial<ScoringResponse> = {}): ScoringResponse => ({
    item_id: items.get(slug)!.id,
    mechanic: items.get(slug)!.mechanic,
    response,
    ...extra,
  });
  return [
    r('fo_mission_dilemma', { choice: 'mission' }),
    r('fo_mission_sjt', { choice: 'adapt' }),
    r('fo_autonomy_cardsort', { picked: ['flow', 'sprint'] }),
    r('fo_risk_dilemma', { choice: 'bet' }),
    r('fo_growth_allocation', { allocation: { growth: 100, runway: 0 } }),
    r('fo_growth_dilemma', { choice: 'blitz' }),
    r('fo_speed_timed', { choice: 'ship' }, { latency_ms: 0 }),
    r('fo_speed_dilemma', { choice: 'fast' }),
    r('fo_reflection_reveal', { takeaway: 'n/a' }),
  ];
}

const VALUE_DIMS = [
  'founder_mission_vs_profit',
  'founder_autonomy_vs_structure',
  'founder_risk_appetite',
  'founder_growth_vs_sustain',
  'founder_speed_vs_quality',
];

test('founder_origin_v1 playthrough scores all 5 spectrums in range with a skill vector', () => {
  const db = seedDb();
  const items = loadItems(db);
  assert.equal(items.size, 10, 'seed should define 10 items');

  const { valueVector, skillVector, confidence } = computeAssessment(
    [...items.values()],
    rocketeerResponses(items),
  );

  for (const dim of VALUE_DIMS) {
    assert.ok(dim in valueVector, `value vector should include ${dim}`);
    assert.ok(valueVector[dim] >= -2 && valueVector[dim] <= 2, `${dim} in [-2,2]`);
    assert.ok(dim in confidence, `confidence should include ${dim}`);
  }

  // High-intent answers resolve as expected.
  assert.equal(valueVector['founder_risk_appetite'], 2);
  assert.equal(valueVector['founder_growth_vs_sustain'], 2);
  assert.equal(valueVector['founder_speed_vs_quality'], 2);
  assert.equal(valueVector['founder_mission_vs_profit'], 0); // +2 / -2 cancel

  // Skill vector forms only over real radar axes, each clamped to [0,5].
  assert.ok(Object.keys(skillVector).length > 0, 'a skill vector should form');
  for (const [axis, level] of Object.entries(skillVector)) {
    assert.ok(SKILL_AXIS_SLUGS.has(axis), `${axis} must be a radar axis`);
    assert.ok(level >= 0 && level <= 5, `${axis} level in [0,5]`);
  }
  // sjt seniority_hint floors gtm_sales at 3 even though its summed loads are lower.
  assert.equal(skillVector['gtm_sales'], 3);
});

test('a contradicted spectrum is flagged and loses confidence; an agreeing one keeps it', () => {
  const db = seedDb();
  const items = loadItems(db);
  const { confidence, flags } = computeAssessment([...items.values()], rocketeerResponses(items));

  // mission was answered +2 (dilemma) then -2 (sjt) → contradiction, conf halved.
  const contradiction = flags.find(
    (f) => f.type === 'contradiction' && f.dimension === 'founder_mission_vs_profit',
  );
  assert.ok(contradiction, 'mission spectrum should raise a contradiction flag');
  assert.equal(confidence['founder_mission_vs_profit'], 0.5);

  // growth was answered by two AGREEING mechanics → full confidence, no flag.
  assert.equal(confidence['founder_growth_vs_sustain'], 1);
  assert.ok(
    !flags.some((f) => f.type === 'contradiction' && f.dimension === 'founder_growth_vs_sustain'),
    'agreeing growth spectrum should not be flagged',
  );
});

test('archetype assignment is deterministic and picks the nearest centroid', () => {
  const db = seedDb();
  const items = loadItems(db);
  const archetypes = loadArchetypes(db);
  assert.equal(archetypes.length, 4, 'seed should define 4 archetypes');

  const scored = computeAssessment([...items.values()], rocketeerResponses(items));
  const vectors = { valueVector: scored.valueVector, skillVector: scored.skillVector };

  const a1 = assignArchetype(archetypes, vectors);
  const a2 = assignArchetype(archetypes, vectors);
  assert.ok(a1, 'an archetype should be assigned');
  assert.deepEqual(a1, a2, 'assignment must be deterministic');
  assert.equal(a1!.slug, 'fo_rocketeer');
  assert.equal(a1!.badge_slug, 'fo_archetype_rocketeer');

  // It really is the global minimum distance.
  let manualBest = Number.POSITIVE_INFINITY;
  for (const arch of archetypes) {
    let sumSq = 0;
    let count = 0;
    for (const [k, v] of Object.entries(arch.centroid.values || {})) {
      if (k in vectors.valueVector) {
        sumSq += (vectors.valueVector[k] - Number(v)) ** 2;
        count++;
      }
    }
    for (const [k, v] of Object.entries(arch.centroid.skills || {})) {
      if (k in vectors.skillVector) {
        sumSq += (vectors.skillVector[k] - Number(v)) ** 2;
        count++;
      }
    }
    if (count) manualBest = Math.min(manualBest, Math.sqrt(sumSq / count));
  }
  assert.equal(a1!.distance, Math.round(manualBest * 100) / 100);
});

test('integrity HMAC signs, verifies, and rejects tampering', async () => {
  const env: any = { SCORING_HMAC_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40) };
  const db = seedDb();
  const items = loadItems(db);
  const scored = computeAssessment([...items.values()], rocketeerResponses(items));
  const archetype = assignArchetype(loadArchetypes(db), {
    valueVector: scored.valueVector,
    skillVector: scored.skillVector,
  });

  const input = {
    userId: 7,
    sessionId: 42,
    track: 'founder_origin_v1',
    valueVector: scored.valueVector,
    skillVector: scored.skillVector,
    archetypeSlug: archetype!.slug,
  };
  const hash = await signResult(env, input);
  assert.match(hash, /^[0-9a-f]{64}$/, 'HMAC-SHA256 hex digest');
  assert.equal(await verifyResult(env, input, hash), true);

  // Tamper: a different archetype must not verify against the original hash.
  assert.equal(await verifyResult(env, { ...input, archetypeSlug: 'fo_missionary' }, hash), false);

  // Canonical serialization is key-order independent (deterministic hash basis).
  const reordered = {
    archetypeSlug: input.archetypeSlug,
    track: input.track,
    valueVector: input.valueVector,
    userId: input.userId,
    skillVector: input.skillVector,
    sessionId: input.sessionId,
  };
  assert.equal(canonicalResult(input), canonicalResult(reordered as any));
});

test('levelForXp follows the floor(sqrt(xp/100))+1 curve', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(399), 2);
  assert.equal(levelForXp(400), 3);
  assert.equal(levelForXp(900), 4);
});
