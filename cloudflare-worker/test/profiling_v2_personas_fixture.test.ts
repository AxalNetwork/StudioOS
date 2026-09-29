/**
 * The Profiling v2 persona fixture stays true to the banks and to the spec —
 * D356, documentation/architecture/PROFILING_V2.md §7.0 and §9.
 *
 * The fixture is the contract later sessions build against, so it must not
 * drift from what it describes:
 *   * every answer names a REAL fit question of the persona's role, with a
 *     value that question accepts;
 *   * every expected archetype exists in that role's set, and the sixteen
 *     archetype personas cover the sixteen archetypes exactly once;
 *   * the evolution parameters equal the spec's table — one number changed in
 *     either place fails here;
 *   * every person is obviously synthetic.
 * It asserts nothing about how any engine classifies them: that is the
 * baseline report's job (cloudflare-worker/scripts/profiling-v2-baseline.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fitMeasuresIndex } from '../src/services/advisor/questionBank.ts';
import { ARCHETYPES, ARCHETYPE_TRAITS } from '../src/services/archetypeScoring.ts';
import { ARCHETYPE_PRESENTATION_OPTIONS } from '../src/services/archetypePresentation.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FIXTURE = JSON.parse(read('cloudflare-worker/test/fixtures/profiling-v2-personas.json'));
const SPEC = read('documentation/architecture/PROFILING_V2.md');
const PERSONAS: any[] = FIXTURE.personas;
const ROLES = ['founder', 'investor', 'partner', 'advisor'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const INDEX = new Map(fitMeasuresIndex().map((e) => [e.question_id, e]));
const slugsOf = (role: string) => (ARCHETYPES as any)[role].map((a: any) => a.slug);
const axes: string[] = RADAR_AXES.map((a) => a.slug);

test('every answer is a real fit question of the persona’s role, with a value it accepts', () => {
  for (const p of PERSONAS) {
    assert.ok(ROLES.includes(p.role), `${p.key}: role ${p.role}`);
    assert.ok(p.answers.length > 0, `${p.key}: no answers`);
    for (const a of p.answers) {
      const q = INDEX.get(a.question_id);
      assert.ok(q, `${p.key}: ${a.question_id} is not a fit question`);
      // The advisor conversation delivers the coach bank too (questionBank.ts
      // bankFor), so an advisor persona also answers fit.coach.* (Session 12).
      const roles = p.role === 'advisor' ? ['advisor', 'coach'] : [p.role];
      assert.ok(roles.includes(q!.persona), `${p.key}: ${a.question_id} belongs to ${q!.persona}`);
      assert.match(a.answered_at, ISO, `${p.key}: ${a.question_id} answered_at`);
      if (q!.choices) {
        assert.ok(q!.choices.some((c) => c.key === a.value), `${p.key}: ${a.question_id} = ${a.value} is not an option key`);
      } else if (q!.measures.archetype_presentation) {
        assert.ok((ARCHETYPE_PRESENTATION_OPTIONS as readonly string[]).includes(a.value), `${p.key}: ${a.value}`);
      } else if (q!.measures.archetype_choice) {
        // A pick-one stores the key of one of its own options (D319, D491, §3.3).
        assert.ok((q!.choices || []).some((c) => c.key === a.value), `${p.key}: ${a.question_id} = ${a.value} is not one of its options`);
      } else {
        assert.ok(Number.isInteger(a.value) && a.value >= 0 && a.value <= 5, `${p.key}: ${a.question_id} = ${a.value}`);
      }
    }
  }
});

test('each archetype persona answers every archetype question of its role — trait probe or pick-one — once', () => {
  for (const p of PERSONAS.filter((x) => x.kind === 'archetype')) {
    const traitIds = [...INDEX.values()].filter((e) => e.persona === p.role && (e.measures.archetype_trait || e.measures.archetype_choice)).map((e) => e.question_id).sort();
    const answered = p.answers.map((a: any) => a.question_id);
    assert.equal(new Set(answered).size, answered.length, `${p.key}: a question answered twice`);
    assert.deepEqual(traitIds.filter((id) => answered.includes(id)), traitIds, `${p.key}: a trait question is missing`);
  }
});

test('the sixteen archetype personas cover the sixteen archetypes exactly once', () => {
  const archetype = PERSONAS.filter((p) => p.kind === 'archetype');
  assert.equal(archetype.length, 16);
  for (const role of ROLES) {
    const got = archetype.filter((p) => p.role === role).map((p) => p.expected.primary).sort();
    assert.deepEqual(got, [...slugsOf(role)].sort(), role);
  }
});

test('blends name a primary and a different secondary from the same role', () => {
  const blends = PERSONAS.filter((p) => p.kind === 'blend');
  assert.ok(blends.length >= 2);
  for (const p of blends) {
    assert.ok(slugsOf(p.role).includes(p.expected.primary), p.key);
    assert.ok(slugsOf(p.role).includes(p.expected.secondary), p.key);
    assert.notEqual(p.expected.primary, p.expected.secondary, p.key);
  }
});

test('evolution personas carry ordered checkpoints over real archetypes and radar axes', () => {
  const evo = PERSONAS.filter((p) => p.kind === 'evolution');
  assert.ok(evo.length >= 4);
  for (const p of evo) {
    assert.ok(p.checkpoints.length >= 3, p.key);
    const dates = p.checkpoints.map((c: any) => c.at);
    assert.deepEqual([...dates].sort(), dates, `${p.key}: checkpoints out of order`);
    for (const c of p.checkpoints) {
      assert.match(c.at, DAY);
      assert.ok(slugsOf(p.role).includes(c.displayed), `${p.key} @ ${c.at}: displayed ${c.displayed}`);
      assert.ok(slugsOf(p.role).includes(c.computed), `${p.key} @ ${c.at}: computed ${c.computed}`);
      for (const axis of Object.keys(c.skills || {})) assert.ok(axes.includes(axis), `${p.key}: axis ${axis}`);
    }
    assert.equal(p.expected.primary, p.checkpoints.at(-1).displayed, `${p.key}: expected is the last displayed`);
    for (const e of p.evidence) {
      assert.ok(axes.includes(e.axis), `${p.key}: evidence axis ${e.axis}`);
      assert.match(e.occurred_at, ISO);
      assert.match(e.source, /^[a-z_]+(\.[a-z_]+)+$/);
    }
  }
});

test('a displayed change never lands on the day the computed archetype first differs', () => {
  // Hysteresis in the fixture's own terms: whenever two consecutive
  // checkpoints show a different displayed archetype, the computed archetype
  // already disagreed with the old one at an earlier checkpoint, or the gap
  // between checkpoints is at least hysteresis_days.
  const hold = FIXTURE.params.hysteresis_days;
  for (const p of PERSONAS.filter((x) => x.kind === 'evolution')) {
    const cks = p.checkpoints;
    for (let i = 1; i < cks.length; i += 1) {
      if (cks[i].displayed === cks[i - 1].displayed) continue;
      assert.equal(cks[i].displayed, cks[i].computed, `${p.key} @ ${cks[i].at}: displayed must be the computed winner when it changes`);
      const gap = (Date.parse(cks[i].at) - Date.parse(cks[i - 1].at)) / 86400000;
      const warned = cks[i - 1].computed === cks[i].displayed;
      assert.ok(warned || gap >= hold, `${p.key} @ ${cks[i].at}: switched without ${hold} days of lead`);
    }
  }
});

test('the fixture’s evolution parameters equal the spec’s table (§7.0)', () => {
  const section = SPEC.slice(SPEC.indexOf('### 7.0 Parameters'), SPEC.indexOf('### 7.1'));
  const table: Record<string, number> = {};
  for (const m of section.matchAll(/^\| `([a-z_]+)` \| ([0-9.]+) \|/gm)) table[m[1]] = Number(m[2]);
  assert.deepEqual(Object.keys(table).sort(), Object.keys(FIXTURE.params).sort(), 'the same parameters');
  for (const [k, v] of Object.entries(FIXTURE.params)) assert.equal(table[k], v, k);
});

test('every person is synthetic and appears once', () => {
  const emails = PERSONAS.map((p) => p.email);
  assert.equal(new Set(emails).size, emails.length);
  assert.equal(new Set(PERSONAS.map((p) => p.key)).size, PERSONAS.length);
  for (const e of emails) assert.match(e, /^[a-z.]+@example\.test$/);
});

test('trait keys in the spec are the engine’s', () => {
  assert.deepEqual([...ARCHETYPE_TRAITS], ['builder', 'visionary', 'connector', 'operator']);
  assert.match(SPEC, /\*\*builder, visionary, connector, operator\*\*/);
});
