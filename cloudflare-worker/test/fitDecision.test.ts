/**
 * Fit v2 — pure decision-engine unit tests (services/fitDecision.ts).
 *
 * Covers, without any D1:
 *   - v1-vocabulary pinning: FIT_V2_VALUES / FIT_V2_TRAITS extend the v1
 *     constants (fitRoles keeps literals to avoid import cycles — this test is
 *     the guard that they never drift from axalFit / archetypeScoring);
 *   - normalizeV2Answer per kind (reverse scoring, option key/label, partial
 *     rankings, multi-select, evidence length);
 *   - cultureScore shortfall-only semantics + weight renormalization;
 *   - roleScore renormalization over answered weights;
 *   - classifyArchetypeV2 (6 centroids incl. scout/steward; <3 axes → null);
 *   - the ordered outcome gates: insufficient → misaligned → flag caps →
 *     high → specialist → conditional → low;
 *   - end-to-end assembleDecision over the real founder bank.
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXAL_VALUES_BASELINE,
  CONTRADICTION_FLAG,
  FIT_V2_THRESHOLDS,
  assembleDecision,
  classifyArchetypeV2,
  computeLayers,
  cultureScore,
  decideOutcome,
  normalizeV2Answer,
  rateEvidenceText,
  roleScore,
  type FitV2Layers,
} from '../src/services/fitDecision.ts';
import { FIT_ROLE_TEMPLATES, FIT_V2_TRAITS, FIT_V2_VALUES } from '../src/services/fitRoles.ts';
import { AXAL_VALUES, RED_FLAGS } from '../src/services/axalFit.ts';
import { ARCHETYPE_TRAITS } from '../src/services/archetypeScoring.ts';
import { fitV2BankFor, type Question } from '../src/services/advisor/questionBank.ts';

// ── v1 vocabulary pinning ────────────────────────────────────────────────────

test('FIT_V2_VALUES = v1 AXAL_VALUES + ambition (order preserved)', () => {
  assert.deepEqual(FIT_V2_VALUES.slice(0, AXAL_VALUES.length), [...AXAL_VALUES]);
  assert.deepEqual(FIT_V2_VALUES.slice(AXAL_VALUES.length), ['ambition']);
});

test('FIT_V2_TRAITS = v1 ARCHETYPE_TRAITS + scout + steward (order preserved)', () => {
  assert.deepEqual(FIT_V2_TRAITS.slice(0, ARCHETYPE_TRAITS.length), [...ARCHETYPE_TRAITS]);
  assert.deepEqual(FIT_V2_TRAITS.slice(ARCHETYPE_TRAITS.length), ['scout', 'steward']);
});

test('engine flag vocabulary stays inside the v1 RED_FLAGS set', () => {
  assert.ok((RED_FLAGS as readonly string[]).includes('weak_ethics'));
  assert.ok((RED_FLAGS as readonly string[]).includes(CONTRADICTION_FLAG));
});

// ── normalizeV2Answer ────────────────────────────────────────────────────────

const likert = (over: Partial<Question['fit_v2']> = {}): Question => ({
  id: 'fit.founder.v2_t_likert', persona: 'founder', prompt: 'p', input_kind: 'scale',
  fit_v2: { module: 'values', stage: 'values', kind: 'likert', value_key: 'integrity', ...over },
});

test('normalize: likert parses 0..5, rejects junk, honors reverse_scored', () => {
  assert.equal(normalizeV2Answer(likert(), '4')!.score, 4);
  assert.equal(normalizeV2Answer(likert({ reverse_scored: true }), '4')!.score, 1);
  assert.equal(normalizeV2Answer(likert(), '9'), null);
  assert.equal(normalizeV2Answer(likert(), 'soon'), null);
});

test('normalize: choice kinds resolve key or label, apply loads/score/flag', () => {
  const q: Question = {
    id: 'fit.founder.v2_t_fc', persona: 'founder', prompt: 'p', input_kind: 'select',
    fit_v2: {
      module: 'archetypes', stage: 'archetypes', kind: 'forced_choice',
      options_v2: [
        { key: 'a', label: 'Option A', loads: { 'trait:builder': 4.5 } },
        { key: 'b', label: 'Option B', score: 1, flag: 'weak_ethics' },
      ],
    },
  };
  const byKey = normalizeV2Answer(q, 'a')!;
  assert.deepEqual(byKey.loads, [{ dim: 'trait:builder', level: 4.5, weight: 1 }]);
  const byLabel = normalizeV2Answer(q, 'Option B')!;
  assert.deepEqual(byLabel.flags, ['weak_ethics']);
  assert.equal(normalizeV2Answer(q, 'zzz'), null);
});

test('normalize: rankings weight by position and accept a single top pick', () => {
  const q: Question = {
    id: 'fit.founder.v2_t_rank', persona: 'founder', prompt: 'p', input_kind: 'select',
    fit_v2: {
      module: 'archetypes', stage: 'archetypes', kind: 'rank_order',
      options_v2: [
        { key: 'x', label: 'X', loads: { 'trait:scout': 4 } },
        { key: 'y', label: 'Y', loads: { 'trait:operator': 4 } },
        { key: 'z', label: 'Z', loads: { 'trait:steward': 4 } },
      ],
    },
  };
  const full = normalizeV2Answer(q, 'x,y,z')!;
  const weights = Object.fromEntries(full.loads.map((l) => [l.dim, l.weight]));
  assert.equal(weights['trait:scout'], 1);
  assert.equal(weights['trait:operator'], 0.5);
  assert.equal(weights['trait:steward'], 0);
  const single = normalizeV2Answer(q, 'y')!; // chat degrade: top-1 at full weight
  assert.deepEqual(single.loads, [{ dim: 'trait:operator', level: 4, weight: 1 }]);
});

test('normalize: evidence enforces min length; rateEvidenceText bands 0/1/2', () => {
  const q: Question = {
    id: 'fit.founder.v2_t_ev', persona: 'founder', prompt: 'p', input_kind: 'long',
    fit_v2: { module: 'values', stage: 'values', kind: 'behavioral_evidence', value_key: 'integrity', evidence: { min_len: 100, probe: 'example' } },
  };
  assert.equal(normalizeV2Answer(q, 'too short'), null);
  const long = 'I told our anchor client the pilot metrics were wrong, reran the analysis with their team over two weeks, and we kept the contract on honest numbers.';
  assert.ok(normalizeV2Answer(q, long));
  assert.equal(rateEvidenceText('meh'), 0);
  assert.equal(rateEvidenceText('A real example that clears the floor but has nothing specific in it at all, just narrative and vibes and more narrative.'), 1);
  assert.equal(rateEvidenceText('In Q2 2025 we cut burn by 30% and extended runway 4 months by renegotiating two vendor contracts.'), 2);
});

// ── layer scores ─────────────────────────────────────────────────────────────

test('cultureScore: only shortfalls below the baseline penalize; weights renormalize', () => {
  // Exactly at baseline everywhere → 100.
  const atBaseline: FitV2Layers['values'] = {};
  for (const k of FIT_V2_VALUES) atBaseline[k] = { score: AXAL_VALUES_BASELINE[k], confidence: 1, n: 3 };
  assert.equal(cultureScore(atBaseline), 100);
  // Exceeding the baseline is never penalized.
  const above: FitV2Layers['values'] = { integrity: { score: 1, confidence: 1, n: 3 } };
  assert.equal(cultureScore(above), 100);
  // A single scored value renormalizes to its own weight.
  const lowIntegrity: FitV2Layers['values'] = { integrity: { score: 0.4, confidence: 1, n: 3 } };
  // shortfall 0.5 × w2 / w2 = 0.5 → 50.
  assert.equal(cultureScore(lowIntegrity), 50);
  assert.equal(cultureScore({}), null);
});

test('roleScore: normalizes over answered weights; a missing part renormalizes to the other', () => {
  const tpl = FIT_ROLE_TEMPLATES.founder;
  const layers = {
    skills: { fitv2_execution_management: { score: 5, confidence: 1, n: 2, validated: true } },
    rubric: {},
  } as unknown as FitV2Layers;
  assert.equal(roleScore(layers, tpl), 100); // skills-only, one perfect answered skill
  const mixed = {
    skills: { fitv2_execution_management: { score: 5, confidence: 1, n: 2, validated: true } },
    rubric: { execution_ability: { score: 0, n: 1 } },
  } as unknown as FitV2Layers;
  assert.equal(roleScore(mixed, tpl), 60); // 0.6×1 + 0.4×0
  assert.equal(roleScore({ skills: {}, rubric: {} } as unknown as FitV2Layers, tpl), null);
});

test('classifyArchetypeV2: scout-dominant answers classify scout; <3 axes → null', () => {
  const traits: FitV2Layers['traits'] = {
    scout: { score: 4.8, n: 3 }, visionary: { score: 3.2, n: 2 }, operator: { score: 1.8, n: 2 },
    builder: { score: 2.2, n: 1 }, connector: { score: 2.6, n: 1 }, steward: { score: 2.0, n: 1 },
  };
  const c = classifyArchetypeV2(traits)!;
  assert.equal(c.primary, 'scout');
  assert.ok(c.secondary && c.secondary !== 'scout');
  assert.ok(c.confidence > 0 && c.confidence <= 1);
  assert.equal(classifyArchetypeV2({ builder: { score: 5, n: 1 }, scout: { score: 1, n: 1 } }), null);
});

// ── decideOutcome gate matrix ────────────────────────────────────────────────

function layersFixture(over: Partial<FitV2Layers> = {}): FitV2Layers {
  // All six values scored (at baseline) so the insufficient-evidence gate's
  // "≥3 scored value dims" check passes unless a test overrides it.
  const values: FitV2Layers['values'] = {};
  for (const k of FIT_V2_VALUES) values[k] = { score: AXAL_VALUES_BASELINE[k], confidence: 1, n: 3 };
  return {
    values, traits: {}, skills: {}, rubric: {},
    flags: [], contradictions: [], confidenceChecks: [],
    evidence: { items: 3, scored: 3, quality: 0.8 },
    coverage: { values: 0.9, archetypes: 0.8, skills: 0.9, validation: 0.8 },
    answeredCount: 60,
    ...over,
  };
}
const tpl = FIT_ROLE_TEMPLATES.founder;
const base = { culture: 85, role: 85, confidence: 0.8, layers: layersFixture(), tpl };

test('outcomes: the seven ordered gates', () => {
  // insufficient evidence runs first (confidence floor).
  assert.equal(decideOutcome({ ...base, confidence: 0.2 }).outcome, 'insufficient_evidence');
  // misaligned: culture floor OR ethics flag beats great skills.
  assert.equal(decideOutcome({ ...base, culture: 30 }).outcome, 'misaligned');
  assert.equal(decideOutcome({ ...base, layers: layersFixture({ flags: ['weak_ethics'] }) }).outcome, 'misaligned');
  // integrity contradiction is ethics-class.
  assert.equal(decideOutcome({
    ...base,
    layers: layersFixture({ contradictions: [{ pair: ['a', 'b'], delta: 3, dimension: 'value:integrity' }] }),
  }).outcome, 'misaligned');
  // high fit.
  assert.equal(decideOutcome(base).outcome, 'high_fit');
  // one non-ethics flag caps a would-be high fit at conditional.
  assert.equal(decideOutcome({ ...base, layers: layersFixture({ flags: ['overconfidence'] }) }).outcome, 'conditional_fit');
  // two non-ethics flags cap at low fit.
  assert.equal(decideOutcome({
    ...base, layers: layersFixture({ flags: ['overconfidence', 'poor_follow_through'] }),
  }).outcome, 'low_fit');
  // specialist: strong role, culture in the specialist band.
  assert.equal(decideOutcome({ ...base, culture: 50, role: 80 }).outcome, 'specialist_fit');
  // conditional: clears the conditional bars with gaps.
  assert.equal(decideOutcome({ ...base, culture: 65, role: 60 }).outcome, 'conditional_fit');
  // would-be high fit held back only by confidence → conditional, not high.
  assert.equal(decideOutcome({ ...base, confidence: 0.5 }).outcome, 'conditional_fit');
  // low fit.
  assert.equal(decideOutcome({ ...base, culture: 62, role: 30 }).outcome, 'low_fit');
});

test('outcomes: a non-ethics contradiction blocks high fit (conditional instead)', () => {
  const withContradiction = layersFixture({
    contradictions: [{ pair: ['a', 'b'], delta: 2, dimension: 'value:curiosity' }],
  });
  assert.equal(decideOutcome({ ...base, layers: withContradiction }).outcome, 'conditional_fit');
});

test('gaps: must-have skills below the bar and baseline shortfalls are enumerated', () => {
  const layers = layersFixture({
    skills: { fitv2_execution_management: { score: 2, confidence: 1, n: 2, validated: false } },
    values: {
      integrity: { score: 0.9, confidence: 1, n: 3 },
      curiosity: { score: 0.8, confidence: 1, n: 3 },
      stewardship: { score: 0.4, confidence: 1, n: 3 },
    },
  });
  const d = decideOutcome({ ...base, culture: 65, role: 60, layers });
  assert.ok(d.gaps.some((g) => g.layer === 'skills' && g.key === 'fitv2_execution_management'));
  assert.ok(d.gaps.some((g) => g.layer === 'values' && g.key === 'stewardship'));
});

// ── end-to-end over the real founder bank ────────────────────────────────────

const FOUNDER_BANK = fitV2BankFor('founder', { coreOnly: false });

/** Answer every item in the bank as an exemplary candidate. */
function exemplaryAnswers(bank: Question[]): Array<{ question_id: string; raw: string }> {
  const out: Array<{ question_id: string; raw: string }> = [];
  const evidence =
    'In Q1 2025 I personally told our lead investor we would miss the quarter by 18%, shipped the recovery plan the same week, and we closed the follow-on in June on the honest numbers.';
  for (const q of bank) {
    const v2 = q.fit_v2!;
    switch (v2.kind) {
      case 'likert':
        out.push({ question_id: q.id, raw: v2.reverse_scored ? '0' : '5' });
        break;
      case 'confidence_check':
        out.push({ question_id: q.id, raw: '5' });
        break;
      case 'forced_choice':
      case 'sjt':
      case 'tradeoff': {
        // Pick the highest-scoring option (or the first when preference-only).
        const best = [...(v2.options_v2 || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        if (best) out.push({ question_id: q.id, raw: best.key });
        break;
      }
      case 'multi_select': {
        const first = v2.options_v2?.[0];
        if (first) out.push({ question_id: q.id, raw: first.key });
        break;
      }
      case 'behavioral_evidence':
        out.push({ question_id: q.id, raw: evidence });
        break;
      default:
        break;
    }
  }
  return out;
}

test('e2e: an exemplary, consistent, evidenced founder scores high_fit', () => {
  const d = assembleDecision(1, 'founder', FOUNDER_BANK, exemplaryAnswers(FOUNDER_BANK));
  assert.equal(d.outcome, 'high_fit');
  assert.ok(d.culture_score >= FIT_V2_THRESHOLDS.high_culture, `culture ${d.culture_score}`);
  assert.ok(d.role_score >= FIT_V2_THRESHOLDS.high_role, `role ${d.role_score}`);
  assert.ok(d.confidence >= FIT_V2_THRESHOLDS.high_confidence, `confidence ${d.confidence}`);
  assert.equal(d.contradictions.length, 0);
  assert.equal(d.flags.length, 0);
  assert.ok(d.archetype_primary, 'archetype classified');
  assert.ok(d.narrative.length > 40);
});

test('e2e: choosing the concealment tradeoff fires weak_ethics and forces misaligned', () => {
  const answers = exemplaryAnswers(FOUNDER_BANK).map((a) =>
    a.question_id === 'fit.founder.v2_val_integrity_trade' ? { ...a, raw: 'hold_cycle' } : a,
  );
  const d = assembleDecision(1, 'founder', FOUNDER_BANK, answers);
  assert.ok(d.flags.includes('weak_ethics'));
  assert.equal(d.outcome, 'misaligned');
});

test('e2e: contradictory reverse pairs are detected and fire the consistency flag', () => {
  // Agree strongly with BOTH each direct item and its reverse-keyed partner:
  // after un-reversing, the pair lands 5 vs 0 → delta 5 on every pair.
  const answers = exemplaryAnswers(FOUNDER_BANK).map((a) => {
    const q = FOUNDER_BANK.find((x) => x.id === a.question_id)!;
    return q.fit_v2!.reverse_scored ? { ...a, raw: '5' } : a;
  });
  const d = assembleDecision(1, 'founder', FOUNDER_BANK, answers);
  assert.ok(d.contradictions.length >= 2, `expected ≥2 contradictions, got ${d.contradictions.length}`);
  assert.ok(d.flags.includes(CONTRADICTION_FLAG));
  assert.notEqual(d.outcome, 'high_fit');
});

test('e2e: a thin profile lands insufficient_evidence, never a fabricated score', () => {
  const few = exemplaryAnswers(FOUNDER_BANK).slice(0, 4);
  const d = assembleDecision(1, 'founder', FOUNDER_BANK, few);
  assert.equal(d.outcome, 'insufficient_evidence');
});

test('e2e: computeLayers caps unvalidated skill claims at the cap threshold', () => {
  // Answer ONLY the ten self-ratings at 5 — no SJT/evidence backing.
  const selfOnly = FOUNDER_BANK
    .filter((q) => q.fit_v2?.module === 'skills' && q.fit_v2.kind === 'likert' && q.fit_v2.skill_v2?.weight == null)
    .map((q) => ({ question_id: q.id, raw: '5' }));
  const layers = computeLayers(FOUNDER_BANK, selfOnly);
  for (const [slug, s] of Object.entries(layers.skills)) {
    assert.ok(s.score <= FIT_V2_THRESHOLDS.unvalidated_skill_cap, `${slug} should be capped, got ${s.score}`);
    assert.equal(s.validated, false);
  }
});
