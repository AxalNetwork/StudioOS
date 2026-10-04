/**
 * Task #45 — Profiling module registry + confidence-based completion tests.
 *
 * Pins the new completion model that replaced the shallow "answered / bank size"
 * count: four modules (skills / work_values / archetype / axal_fit), each with a
 * reachable `required` = min(floor, available), plus the adaptive selector that
 * skips confident modules and fills coverage gaps.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/profilingModules.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { profilingBankFor, type Persona, type Question } from '../src/services/advisor/questionBank.ts';
import { ARCHETYPE_TRAITS } from '../src/services/archetypeScoring.ts';
import {
  computeProfilingCompletion,
  selectAdaptiveProfiling,
  applyAdaptiveProfiling,
  moduleForQuestion,
  PROFILING_MODULES,
} from '../src/services/advisor/profilingModules.ts';

const PERSONAS: Persona[] = ['founder', 'investor', 'partner', 'advisor'] as Persona[];

test('empty answers → all modules present, 0%, honest reachable denominators', () => {
  for (const persona of PERSONAS) {
    const bank = profilingBankFor(persona);
    const c = computeProfilingCompletion(bank, new Set());
    assert.ok(c.applicable);
    assert.equal(c.percent, 0);
    assert.equal(c.complete, false);
    // All four modules are offered for every persona.
    const keys = c.modules.map((m) => m.key);
    assert.deepEqual([...keys].sort(), ['archetype', 'axal_fit', 'skills', 'work_values']);
    for (const m of c.modules) {
      assert.ok(m.required > 0 && m.required <= m.available, `${persona}.${m.key} required within bounds`);
      assert.equal(m.required, Math.min(PROFILING_MODULES[m.key].floor, m.available));
      assert.equal(m.answered, 0);
      assert.equal(m.confident, false);
    }
  }
});

test('answering a whole module makes it confident and caps its percent at 100', () => {
  const bank = profilingBankFor('founder' as Persona);
  const skillIds = bank.filter((q) => moduleForQuestion(q) === 'skills').map((q) => q.id);
  const answered = new Set(skillIds); // answer ALL skills (7) — more than the floor (5)
  const c = computeProfilingCompletion(bank, answered);
  const skills = c.modules.find((m) => m.key === 'skills')!;
  assert.ok(skills.confident);
  assert.equal(skills.percent, 100);
  // Over-answering skills does not push the OTHER modules or overall to 100.
  assert.ok(c.percent < 100);
  assert.equal(c.complete, false);
});

/**
 * `need` archetype ids that answer every trait first (§4, D519): one per trait
 * in bank order, then the rest of the module in bank order up to `need`.
 */
function archetypeFloor(bank: Question[], need: number): string[] {
  const qs = bank.filter((q) => moduleForQuestion(q) === 'archetype');
  const out: string[] = [];
  for (const t of ARCHETYPE_TRAITS) {
    const q = qs.find((x) => x.measures?.archetype_trait === t);
    if (q) out.push(q.id);
  }
  for (const q of qs) if (out.length < need && !out.includes(q.id)) out.push(q.id);
  return out;
}

test('answering every module to its floor → complete', () => {
  const bank = profilingBankFor('investor' as Persona);
  const answered = new Set<string>();
  for (const key of ['skills', 'work_values', 'archetype', 'axal_fit'] as const) {
    const ids = bank.filter((q) => moduleForQuestion(q) === key).map((q) => q.id);
    const need = Math.min(PROFILING_MODULES[key].floor, ids.length);
    // The archetype floor must reach every trait (§4); the others any order.
    for (const id of key === 'archetype' ? archetypeFloor(bank, need) : ids.slice(0, need)) answered.add(id);
  }
  const c = computeProfilingCompletion(bank, answered);
  assert.ok(c.complete, 'all modules at floor → complete');
  assert.equal(c.percent, 100);
  for (const m of c.modules) assert.ok(m.confident, `${m.key} confident`);
});

test('overall answered/required never double-counts over-answering', () => {
  const bank = profilingBankFor('advisor' as Persona);
  // Answer ALL questions.
  const answered = new Set(bank.map((q) => q.id));
  const c = computeProfilingCompletion(bank, answered);
  // Σ required, and answered is capped at required per module → equal.
  assert.equal(c.answered, c.required);
  assert.equal(c.percent, 100);
});

test('adaptive selector drops questions from already-confident modules', () => {
  const bank = profilingBankFor('founder' as Persona);
  const skillIds = bank.filter((q) => moduleForQuestion(q) === 'skills').map((q) => q.id);
  const answered = new Set(skillIds);
  const next = selectAdaptiveProfiling(bank, answered);
  // No skills question should remain in the candidate pool (module is confident).
  assert.ok(next.every((q) => moduleForQuestion(q) !== 'skills'), 'confident module excluded');
  // Other modules still have candidates.
  assert.ok(next.length > 0);
});

test('adaptive selector prefers gap-filling questions (uncovered axes first)', () => {
  const bank = profilingBankFor('founder' as Persona);
  const skills = bank.filter((q) => moduleForQuestion(q) === 'skills');
  // Answer one skill question; the very next skills candidate should cover a
  // DIFFERENT axis, not pile onto the one already covered.
  const first = skills[0];
  const answered = new Set([first.id]);
  const next = selectAdaptiveProfiling(bank, answered);
  const firstSkillCandidate = next.find((q) => moduleForQuestion(q) === 'skills');
  assert.ok(firstSkillCandidate, 'still has a skills candidate');
  assert.notEqual(
    firstSkillCandidate!.measures?.skill_axis,
    first.measures?.skill_axis,
    'next skills candidate fills a new axis',
  );
});

test('admin / unknown personas → not applicable', () => {
  for (const p of ['admin', 'unknown'] as Persona[]) {
    const c = computeProfilingCompletion(profilingBankFor(p), new Set());
    assert.equal(c.applicable, false);
    assert.equal(c.modules.length, 0);
  }
});

// ---------------------------------------------------------------------------
// applyAdaptiveProfiling — the route-layer trim now wired into the live
// candidate pipeline (/start, /answer, /skip, /next-question, /turn). Proves
// the reviewer's requirement: once a module is confident, subsequent candidates
// no longer come from that module, while non-fit questions survive untouched.
// ---------------------------------------------------------------------------
const nonFit = (id: string): Question =>
  ({ id, persona: 'founder' as Persona, prompt: id, input_kind: 'short' }) as Question;

test('applyAdaptiveProfiling drops confident-module fit questions, keeps non-fit', () => {
  const fit = profilingBankFor('founder' as Persona);
  const skills = fit.filter((q) => moduleForQuestion(q) === 'skills');
  const floor = PROFILING_MODULES.skills.floor;
  assert.ok(skills.length > floor, 'founder skills bank exceeds the floor (extras remain)');
  const answered = new Set(skills.slice(0, floor).map((q) => q.id)); // skills now confident

  // Persona / non-fit questions bracket the fit bank (ids must NOT match fit.*).
  const head = nonFit('role_detect.primary');
  const tail = nonFit('persona.summary');
  const bank: Question[] = [head, ...fit, tail];

  const out = applyAdaptiveProfiling(bank, answered);
  const outIds = new Set(out.map((q) => q.id));

  // Every UNANSWERED skills question is gone (module is confident).
  const unansweredSkills = skills.filter((q) => !answered.has(q.id));
  assert.ok(unansweredSkills.length > 0, 'there were extras to drop');
  for (const q of unansweredSkills) assert.ok(!outIds.has(q.id), `dropped ${q.id}`);
  // Non-fit questions preserved in their original relative order.
  assert.ok(outIds.has(head.id) && outIds.has(tail.id), 'non-fit questions kept');
  assert.ok(out.indexOf(head) < out.indexOf(tail), 'non-fit order preserved');
  // Other (non-confident) modules still contribute candidates.
  assert.ok(out.some((q) => moduleForQuestion(q) === 'archetype'), 'other modules survive');
});

test('applyAdaptiveProfiling keepIds shields a pinned question from the trim', () => {
  const fit = profilingBankFor('founder' as Persona);
  const skills = fit.filter((q) => moduleForQuestion(q) === 'skills');
  const floor = PROFILING_MODULES.skills.floor;
  const answered = new Set(skills.slice(0, floor).map((q) => q.id)); // skills confident
  const pinned = skills[floor]; // an unanswered confident-module question that WOULD drop

  const trimmed = applyAdaptiveProfiling(fit, answered);
  assert.ok(!trimmed.some((q) => q.id === pinned.id), 'without keepIds the pin is dropped');

  const kept = applyAdaptiveProfiling(fit, answered, { keepIds: new Set([pinned.id]) });
  assert.ok(kept.some((q) => q.id === pinned.id), 'keepIds retains the pinned question');
});

test('applyAdaptiveProfiling front-loads gap-filling fit questions', () => {
  const fit = profilingBankFor('founder' as Persona);
  const skills = fit.filter((q) => moduleForQuestion(q) === 'skills');
  const answered = new Set([skills[0].id]);
  const out = applyAdaptiveProfiling(fit, answered);
  const firstSkill = out.find((q) => moduleForQuestion(q) === 'skills' && !answered.has(q.id));
  assert.ok(firstSkill, 'still has an unanswered skills candidate');
  assert.notEqual(
    firstSkill!.measures?.skill_axis,
    skills[0].measures?.skill_axis,
    'first remaining skills candidate fills a new axis',
  );
});

// ---------------------------------------------------------------------------
// PROFILING_V2 §4 (D519): the archetype module is confident only once every
// trait has an answer, in addition to the floor of six. Before D519 the
// module checked the floor alone; gap-filling met the rule in queue order,
// and nothing else did.

const archetypeOf = (bank: Question[], answered: Set<string>) =>
  computeProfilingCompletion(bank, answered).modules.find((m) => m.key === 'archetype')!;

test('§4: six archetype answers that leave a trait unanswered are not confident', () => {
  // The investor bank opens its archetype module with five builder items: the
  // first six in bank order touch two traits, which the old floor-only rule
  // called confident.
  const bank = profilingBankFor('investor' as Persona);
  const qs = bank.filter((q) => moduleForQuestion(q) === 'archetype');
  const firstSix = new Set(qs.slice(0, 6).map((q) => q.id));
  assert.equal(new Set(qs.slice(0, 6).map((q) => q.measures?.archetype_trait)).size, 2, 'fixture: two traits');
  const m = archetypeOf(bank, firstSix);
  assert.equal(m.answered, 6);
  assert.equal(m.required, 6);
  assert.equal(m.confident, false, 'the floor is met but two traits are unanswered');
  assert.deepEqual(m.uncovered_traits, ['connector', 'operator']);
  assert.equal(m.percent, 99, 'the bar never reads full on a module that is not confident');
});

test('§4: in every bank, the floor reached on fewer than four traits is not confident; one more answer per missing trait makes it so', () => {
  for (const persona of PERSONAS) {
    const bank = profilingBankFor(persona);
    const qs = bank.filter((q) => moduleForQuestion(q) === 'archetype');
    // Every live bank asks all four traits — so "every trait" is all four.
    assert.deepEqual([...new Set(qs.map((q) => q.measures?.archetype_trait).filter(Boolean))].sort(),
      [...ARCHETYPE_TRAITS].sort(), `${persona}: the bank asks every trait`);
    // Six answers: every non-trait item and every item on one trait, first.
    const skipped = qs.filter((q) => q.measures?.archetype_trait && q.measures.archetype_trait !== 'builder');
    const six = [...qs.filter((q) => !skipped.includes(q))].slice(0, 6);
    assert.equal(six.length, 6, `${persona}: fixture reaches the floor without three traits`);
    const answered = new Set(six.map((q) => q.id));
    const before = archetypeOf(bank, answered);
    assert.equal(before.confident, false, `${persona}: confident with ${6 - (before.uncovered_traits?.length ?? 0)} trait(s)`);
    assert.ok((before.uncovered_traits?.length ?? 0) >= 3, `${persona}: uncovered ${before.uncovered_traits}`);
    const c = computeProfilingCompletion(bank, answered);
    assert.equal(c.complete, false);

    for (const t of before.uncovered_traits!) answered.add(qs.find((q) => q.measures?.archetype_trait === t)!.id);
    const after = archetypeOf(bank, answered);
    assert.equal(after.confident, true, `${persona}: every trait answered and the floor met`);
    assert.deepEqual(after.uncovered_traits, []);
    assert.equal(after.percent, 100);
  }
});

test('§4: every trait answered below the floor is still not confident — the floor still holds', () => {
  const bank = profilingBankFor('founder' as Persona);
  const answered = new Set(archetypeFloor(bank, 4));
  const m = archetypeOf(bank, answered);
  assert.deepEqual(m.uncovered_traits, []);
  assert.equal(m.answered, 4);
  assert.equal(m.confident, false);
});

test('§4: the overall figure cannot read 100 while the archetype is short of a trait', () => {
  const bank = profilingBankFor('investor' as Persona);
  const answered = new Set<string>();
  for (const key of ['skills', 'work_values', 'axal_fit'] as const) {
    const ids = bank.filter((q) => moduleForQuestion(q) === key).map((q) => q.id);
    for (const id of ids.slice(0, Math.min(PROFILING_MODULES[key].floor, ids.length))) answered.add(id);
  }
  for (const q of bank.filter((x) => moduleForQuestion(x) === 'archetype').slice(0, 6)) answered.add(q.id);
  const c = computeProfilingCompletion(bank, answered);
  assert.equal(c.complete, false);
  assert.ok(c.percent < 100, `overall reads ${c.percent}`);
  assert.equal(c.answered, c.required - 1, 'the archetype counts one short of its floor');
});

test('§4: the adaptive queue keeps asking the archetype until every trait is answered, missing traits first', () => {
  const bank = profilingBankFor('investor' as Persona);
  const qs = bank.filter((q) => moduleForQuestion(q) === 'archetype');
  const answered = new Set(qs.slice(0, 6).map((q) => q.id));
  const next = selectAdaptiveProfiling(bank, answered).filter((q) => moduleForQuestion(q) === 'archetype');
  assert.ok(next.length > 0, 'a module short of a trait is not dropped from the queue');
  assert.ok(['connector', 'operator'].includes(String(next[0].measures?.archetype_trait)),
    `the first archetype candidate is ${next[0].id}, not a missing trait`);
});

test('§4: a trait the bank never asks cannot gate it, and the other modules carry no trait list', () => {
  const q = (id: string, trait: string): Question =>
    ({ id, persona: 'founder' as Persona, prompt: id, input_kind: 'scale', measures: { archetype_trait: trait } }) as Question;
  const bank = [
    q('fit.founder.a1', 'builder'), q('fit.founder.a2', 'builder'), q('fit.founder.a3', 'visionary'),
    q('fit.founder.a4', 'visionary'), q('fit.founder.a5', 'connector'), q('fit.founder.a6', 'connector'),
  ];
  const c = computeProfilingCompletion(bank, new Set(bank.map((x) => x.id)));
  const m = c.modules.find((x) => x.key === 'archetype')!;
  assert.equal(m.confident, true, 'three traits offered, three answered, floor met');
  assert.deepEqual(m.uncovered_traits, []);

  const full = computeProfilingCompletion(profilingBankFor('founder' as Persona), new Set());
  for (const mod of full.modules.filter((x) => x.key !== 'archetype')) {
    assert.equal('uncovered_traits' in mod, false, `${mod.key} carries uncovered_traits`);
  }
});
