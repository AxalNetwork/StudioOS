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

test('answering every module to its floor → complete', () => {
  const bank = profilingBankFor('investor' as Persona);
  const answered = new Set<string>();
  for (const key of ['skills', 'work_values', 'archetype', 'axal_fit'] as const) {
    const ids = bank.filter((q) => moduleForQuestion(q) === key).map((q) => q.id);
    const need = Math.min(PROFILING_MODULES[key].floor, ids.length);
    for (const id of ids.slice(0, need)) answered.add(id);
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
