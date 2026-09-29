/**
 * D491 — the partner fit bank v2 (Profiling v2, Session 11;
 * documentation/architecture/PROFILING_V2.md §3, §4, §5, §6, §7.3).
 *
 * Proves, against the real bank and the real v2 engine:
 *   1. the four partner personas of Session 6's fixture classify as
 *      themselves, confidently, answering THIS bank's own questions — and the
 *      close pair (Embedded Operator / Systems Builder) separates further
 *      than it did before the new items;
 *   2. the fixture's answers to the new items follow the rule written in the
 *      fixture's notes, recomputed here from the bank (so a swapped loading
 *      or a dropped reverse key fails);
 *   3. every situational option stands for exactly the partner archetype it
 *      is written for;
 *   4. a partner blend (two personas' answers interleaved) reports both
 *      archetypes, for each close pair;
 *   5. agreeing with everything — every scale 5, or always the first option —
 *      is not a confident archetype;
 *   6. answering in adaptive queue order reaches every module's floor, with
 *      all four traits covered and the right archetype at the floor;
 *   7. coverage: every radar axis, the partner's value dimensions and all six
 *      Axal values have a partner question; the red flags stay where they
 *      were; every question carries a re-ask wording.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/partner_bank_v2_d491.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIT_PARTNER_BANK } from '../src/services/advisor/banks/fit_partner.ts';
import {
  ARCHETYPE_TRAITS, ARCHETYPES_PROFILE_V2, PROFILE_V2_PARAMS, classifyArchetype, classifyLedgerV2,
  type ArchetypeTrait, type LedgerAnswer, type ScoringItem, type TraitScores,
} from '../src/services/archetypeScoring.ts';
import { computeProfilingCompletion, selectAdaptiveProfiling } from '../src/services/advisor/profilingModules.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';
import type { Question } from '../src/services/advisor/questionBank.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = JSON.parse(readFileSync(resolve(ROOT, 'cloudflare-worker/test/fixtures/profiling-v2-personas.json'), 'utf8'));
const AT = Date.parse('2026-09-01T00:00:00Z');

const BANK = FIT_PARTNER_BANK;
const BY_ID = new Map(BANK.map((q) => [q.id, q]));
const ITEMS: ScoringItem[] = BANK.map((q) => ({ question_id: q.id, measures: q.measures!, reverse: q.reverse, choices: q.choices }));
const key = (q: Question) => q.id.replace('fit.partner.', '');
const isArchetypeItem = (q: Question) => !!(q.measures?.archetype_trait || q.measures?.archetype_choice);
const PICKS = BANK.filter((q) => q.choices);
const REVERSED = BANK.filter((q) => q.reverse);

const CENTROID: Record<string, Record<ArchetypeTrait, number>> = Object.fromEntries(
  ARCHETYPES_PROFILE_V2.partner.map((a) => [a.slug, a.centroid]),
);
const PERSONAS: any[] = FIXTURE.personas.filter((p: any) => p.role === 'partner' && p.kind === 'archetype');
const persona = (slug: string) => PERSONAS.find((p) => p.expected.primary === slug);
const ledgerOf = (p: any): LedgerAnswer[] => p.answers.map((a: any) => ({ question_id: a.question_id, value: String(a.value), answered_at: a.answered_at }));

/**
 * The author's intent for each situation: which partner archetype each option
 * is written for. The loadings must say the same thing (test 3).
 */
const INTENT: Record<string, Record<string, string>> = {
  pick_first_month: { system: 'pt_systems_builder', inside: 'pt_embedded_operator', people: 'pt_strategic_connector', lever: 'pt_growth_catalyst' },
  pick_leave_behind: { team: 'pt_embedded_operator', doors: 'pt_strategic_connector', machine: 'pt_systems_builder', curve: 'pt_growth_catalyst' },
  pick_breaking_process: { growth: 'pt_growth_catalyst', redesign: 'pt_systems_builder', join: 'pt_embedded_operator', expert: 'pt_strategic_connector' },
  pick_short_staffed: { intros: 'pt_strategic_connector', growth: 'pt_growth_catalyst', step_in: 'pt_embedded_operator', tooling: 'pt_systems_builder' },
  pick_success_signal: { no_questions: 'pt_systems_builder', same_way: 'pt_embedded_operator', revenue: 'pt_growth_catalyst', intros: 'pt_strategic_connector' },
  pick_growth_stall: { experiments: 'pt_growth_catalyst', unlock: 'pt_strategic_connector', funnel: 'pt_systems_builder', sell: 'pt_embedded_operator' },
  pick_new_market: { who_to_call: 'pt_strategic_connector', go_with: 'pt_embedded_operator', launch: 'pt_growth_catalyst', playbook: 'pt_systems_builder' },
  pick_good_week: { hands_on: 'pt_embedded_operator', connecting: 'pt_strategic_connector', experiments: 'pt_growth_catalyst', repeatable: 'pt_systems_builder' },
};

/** The reverse-keyed probes and the trait each one lowers. */
const REVERSE_INTENT: Record<string, ArchetypeTrait> = {
  rev_builder_hand_off: 'builder',
  rev_builder_conversation: 'builder',
  rev_visionary_brief: 'visionary',
  rev_visionary_quarter: 'visionary',
  rev_connector_solo: 'connector',
  rev_connector_small_circle: 'connector',
  rev_operator_no_process: 'operator',
  rev_operator_improvise: 'operator',
};

/** The rule in the fixture's notes: a persona's own mean on each trait over its plain probes. */
function personaMeans(p: any): Record<ArchetypeTrait, number> {
  const acc: Partial<Record<ArchetypeTrait, number[]>> = {};
  for (const a of p.answers) {
    const q = BY_ID.get(a.question_id);
    const t = q?.measures?.archetype_trait as ArchetypeTrait | undefined;
    if (t && !q!.reverse) (acc[t] ??= []).push(a.value);
  }
  const out = {} as Record<ArchetypeTrait, number>;
  for (const t of ARCHETYPE_TRAITS) out[t] = acc[t]!.reduce((x, y) => x + y, 0) / acc[t]!.length;
  return out;
}

const rms = (loadings: Record<string, number>, v: Record<string, number>) => {
  const ks = Object.keys(loadings);
  return Math.sqrt(ks.reduce((s, k) => s + (loadings[k] - v[k]) ** 2, 0) / ks.length);
};

function nearestOption(q: Question, v: Record<string, number>): string {
  let best: { k: string; d: number } | null = null;
  for (const c of q.choices!) {
    const d = rms(c.loadings as Record<string, number>, v);
    if (!best || d < best.d) best = { k: c.key, d };
  }
  return best!.k;
}

const answerOf = (p: any, id: string) => p.answers.find((a: any) => a.question_id === id)?.value;
const withoutD491 = (p: any) => ledgerOf(p).filter((a) => { const q = BY_ID.get(a.question_id)!; return !q.reverse && !q.choices; });

// ---------------------------------------------------------------------------
// 1. Personas classify as themselves from this bank's own questions.
// ---------------------------------------------------------------------------

test('each partner persona classifies as itself, confidently, from its whole ledger on this bank', () => {
  assert.equal(PERSONAS.length, 4);
  for (const p of PERSONAS) {
    const r = classifyLedgerV2('partner', ITEMS, ledgerOf(p), AT)!;
    assert.equal(r.primary, p.expected.primary, `${p.key} → ${r.primary}`);
    assert.ok(r.confident, `${p.key}: confidence ${r.confidence} under ${PROFILE_V2_PARAMS.confident_at}`);
    assert.equal(r.traits_covered, 4);
    // Every D491 item was answered, so the result above used them.
    for (const q of [...PICKS, ...REVERSED]) assert.notEqual(answerOf(p, q.id), undefined, `${p.key} did not answer ${key(q)}`);
  }
});

test('the new items separate the close pair: both margins grow and both become confident', () => {
  for (const slug of ['pt_embedded_operator', 'pt_systems_builder']) {
    const p = persona(slug);
    const before = classifyLedgerV2('partner', ITEMS, withoutD491(p), AT)!;
    const after = classifyLedgerV2('partner', ITEMS, ledgerOf(p), AT)!;
    assert.equal(before.primary, slug);
    assert.equal(after.primary, slug);
    assert.ok(after.margin >= before.margin + 0.2, `${slug}: margin ${before.margin} → ${after.margin}`);
    assert.ok(after.confident, `${slug}: ${after.confidence}`);
  }
});

test('the card (v1 until Session 15) still reads each persona as itself, reverse keys inverted', () => {
  for (const p of PERSONAS) {
    const sums: Partial<Record<ArchetypeTrait, { s: number; n: number }>> = {};
    for (const a of p.answers) {
      const q = BY_ID.get(a.question_id);
      const t = q?.measures?.archetype_trait as ArchetypeTrait | undefined;
      if (!t) continue;
      const v = q!.reverse ? 5 - a.value : a.value;
      const b = sums[t] ?? (sums[t] = { s: 0, n: 0 });
      b.s += v; b.n += 1;
    }
    const traits: TraitScores = {};
    for (const t of ARCHETYPE_TRAITS) traits[t] = sums[t]!.s / sums[t]!.n;
    assert.equal(classifyArchetype('partner', traits)!.slug, p.expected.primary, p.key);
  }
});

// ---------------------------------------------------------------------------
// 2. The fixture's answers to the new items follow the documented rule.
// ---------------------------------------------------------------------------

test('the fixture answers every new item by the rule in its notes, recomputed from the bank', () => {
  assert.ok(FIXTURE.notes.some((n: string) => n.startsWith('D491')), 'the fixture no longer states the rule');
  for (const p of PERSONAS) {
    const v = personaMeans(p);
    for (const q of REVERSED) {
      const want = 5 - Math.round(v[q.measures!.archetype_trait as ArchetypeTrait]);
      assert.equal(answerOf(p, q.id), want, `${p.key} ${key(q)}`);
    }
    for (const q of PICKS) assert.equal(answerOf(p, q.id), nearestOption(q, v), `${p.key} ${key(q)}`);
  }
});

test('each persona chooses the option written for its own archetype, in every situation', () => {
  for (const p of PERSONAS) {
    for (const q of PICKS) {
      const chosen = answerOf(p, q.id);
      assert.equal(INTENT[key(q)][chosen], p.expected.primary, `${p.key} chose "${chosen}" on ${key(q)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Every option stands for exactly the archetype it is written for.
// ---------------------------------------------------------------------------

test('each situation offers one option per partner archetype, and each option’s loadings sit on that archetype', () => {
  assert.deepEqual(PICKS.map(key).sort(), Object.keys(INTENT).sort(), 'the situations and the intent table disagree');
  for (const q of PICKS) {
    const intent = INTENT[key(q)];
    assert.deepEqual(q.choices!.map((c) => c.key).sort(), Object.keys(intent).sort(), key(q));
    assert.deepEqual(Object.values(intent).sort(), Object.keys(CENTROID).sort(), `${key(q)}: not one option per archetype`);
    for (const c of q.choices!) {
      const ranked = Object.entries(CENTROID)
        .map(([slug, cen]) => ({ slug, d: rms(c.loadings as Record<string, number>, cen) }))
        .sort((a, b) => a.d - b.d);
      assert.equal(ranked[0].slug, intent[c.key], `${key(q)}.${c.key} loads nearest ${ranked[0].slug}`);
      assert.ok(ranked[1].d - ranked[0].d > 0, `${key(q)}.${c.key} is equally near two archetypes`);
    }
  }
});

test('the close pairs get the separating situations the spec asks for', () => {
  const separates = (a: string, b: string) => PICKS.filter((q) => answerOf(persona(a), q.id) !== answerOf(persona(b), q.id)).length;
  // Brief: 4–5 for the 1.73 pair; spec §3.2 default 3 for the others.
  assert.ok(separates('pt_embedded_operator', 'pt_systems_builder') >= 5);
  assert.ok(separates('pt_strategic_connector', 'pt_growth_catalyst') >= 3);
  const firsts = PICKS.map((q) => INTENT[key(q)][q.choices![0].key]);
  for (const slug of Object.keys(CENTROID)) {
    assert.equal(firsts.filter((s) => s === slug).length, 2, `${slug} is the first option ${firsts.filter((s) => s === slug).length} times`);
  }
});

// ---------------------------------------------------------------------------
// 4. Blends.
// ---------------------------------------------------------------------------

test('a partner blend reports both archetypes, for each close pair', () => {
  const ids = BANK.filter(isArchetypeItem).map((q) => q.id);
  for (const [a, b] of [['pt_embedded_operator', 'pt_systems_builder'], ['pt_strategic_connector', 'pt_growth_catalyst']]) {
    // The two personas' own answers, alternating question by question.
    const ledger = ids.map((id, i) => ({ question_id: id, value: String(answerOf(persona(i % 2 ? b : a), id)), answered_at: '2026-08-20T09:00:00Z' }));
    const r = classifyLedgerV2('partner', ITEMS, ledger, AT)!;
    assert.ok(r.blend, `${a}+${b}: not a blend (margin ${r.margin})`);
    assert.deepEqual([r.primary, r.secondary].sort(), [a, b].sort(), `${a}+${b} → ${r.primary}/${r.secondary}`);
  }
});

// ---------------------------------------------------------------------------
// 5. Agreeing with everything is not a profile.
// ---------------------------------------------------------------------------

test('every trait has at least two reverse-keyed probes, each lowering the trait it is written for', () => {
  assert.deepEqual(REVERSED.map(key).sort(), Object.keys(REVERSE_INTENT).sort());
  for (const q of REVERSED) assert.equal(q.measures!.archetype_trait, REVERSE_INTENT[key(q)], key(q));
  for (const t of ARCHETYPE_TRAITS) assert.ok(REVERSED.filter((q) => q.measures!.archetype_trait === t).length >= 2, t);
});

test('every scale 5 and every first option is not a confident archetype', () => {
  const ledger = BANK.filter((q) => q.input_kind === 'scale' || q.choices).map((q) => ({
    question_id: q.id, value: q.choices ? q.choices[0].key : '5', answered_at: '2026-08-20T09:00:00Z',
  }));
  const r = classifyLedgerV2('partner', ITEMS, ledger, AT)!;
  assert.equal(r.confident, false, `confidence ${r.confidence}`);
});

test('always choosing the first option is not a confident archetype either', () => {
  const ledger = PICKS.map((q) => ({ question_id: q.id, value: q.choices![0].key, answered_at: '2026-08-20T09:00:00Z' }));
  const r = classifyLedgerV2('partner', ITEMS, ledger, AT)!;
  assert.equal(r.traits_covered, 4);
  assert.equal(r.confident, false, `confidence ${r.confidence}`);
});

// ---------------------------------------------------------------------------
// 6. The adaptive run.
// ---------------------------------------------------------------------------

test('answering in queue order reaches every floor, covers every trait, and lands on the right archetype', () => {
  for (const p of PERSONAS) {
    const answered = new Set<string>();
    const ledger: LedgerAnswer[] = [];
    for (let i = 0; i < BANK.length; i += 1) {
      if (computeProfilingCompletion(BANK, answered).complete) break;
      const next = selectAdaptiveProfiling(BANK, answered)[0];
      assert.ok(next, `${p.key}: the queue ran dry before every module was confident`);
      const a = p.answers.find((x: any) => x.question_id === next.id);
      assert.ok(a, `${p.key}: the queue asked ${key(next)}, which the fixture does not answer`);
      answered.add(next.id);
      ledger.push({ question_id: next.id, value: String(a.value), answered_at: a.answered_at });
    }
    const completion = computeProfilingCompletion(BANK, answered);
    assert.ok(completion.complete, `${p.key}: not every module is confident`);
    assert.ok(answered.size <= 25, `${p.key}: ${answered.size} answers to reach every floor`);
    const archetypeAnswered = [...answered].filter((id) => isArchetypeItem(BY_ID.get(id)!));
    assert.equal(archetypeAnswered.length, completion.modules.find((m) => m.key === 'archetype')!.required);
    // The close-pair situations are asked on the way to the floor.
    assert.ok(archetypeAnswered.some((id) => BY_ID.get(id)!.choices), `${p.key}: no situation before the floor`);
    const r = classifyLedgerV2('partner', ITEMS, ledger, AT)!;
    assert.equal(r.traits_covered, 4, `${p.key}: a trait is uncovered at the floor`);
    assert.equal(r.primary, p.expected.primary, `${p.key} at the floor → ${r.primary}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Coverage, values, red flags, re-ask wording.
// ---------------------------------------------------------------------------

test('every radar axis has a partner question, and the three new ones sit on their own axes', () => {
  const axes = new Set(BANK.map((q) => q.measures?.skill_axis).filter(Boolean));
  for (const a of RADAR_AXES) assert.ok(axes.has(a.slug as any), `no partner question on ${a.slug}`);
  const want: Record<string, string> = { skill_engineering_review: 'engineering', skill_design_feedback: 'design', skill_marketing_delivery: 'marketing_brand' };
  for (const [k, axis] of Object.entries(want)) assert.equal(BY_ID.get(`fit.partner.${k}`)?.measures?.skill_axis, axis, k);
  for (const k of Object.keys(want)) assert.match(BY_ID.get(`fit.partner.${k}`)!.prompt, /^In the last year, how often did you/, k);
});

test('values: the partner’s dimensions each have a situation, with the slugs other banks use', () => {
  const want: Record<string, string> = {
    val_founder_way: 'founder_autonomy_vs_structure',
    val_measurable_target: 'schwartz_achievement',
    val_budget_runs_out: 'schwartz_benevolence',
    val_off_brief: 'schwartz_self_direction',
    val_turn_down: 'schwartz_universalism',
  };
  for (const [k, dim] of Object.entries(want)) assert.equal(BY_ID.get(`fit.partner.${k}`)?.measures?.value_dim, dim, k);
});

test('all six Axal values have a situational variant, and the red flags stay on the rows that had them', () => {
  const axal = ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition'];
  for (const v of axal) {
    assert.ok(BANK.filter((q) => q.measures?.axal_value === v).length >= 2, `${v} has no situational variant`);
  }
  const flags = BANK.filter((q) => q.measures?.red_flag).map((q) => `${key(q)}:${q.measures!.red_flag!.key}`).sort();
  assert.deepEqual(flags, [
    'axal_collaboration:ego_over_collaboration', 'axal_integrity:blame_shifting', 'axal_stewardship:transactional',
    'collab_style:ego_over_collaboration', 'rep_conduct:transactional', 'trust_confidentiality:weak_ethics',
    'trust_reliability:poor_follow_through',
  ]);
});

test('every partner question carries its own re-ask wording, as a check-in', () => {
  for (const q of BANK) {
    assert.ok(q.reask_prompt && q.reask_prompt.trim().length > 10, `${key(q)} has no re-ask wording`);
    assert.ok(q.reask_prompt!.trim().endsWith('?'), `${key(q)}: re-ask is not a question`);
    assert.notEqual(q.reask_prompt, q.prompt, `${key(q)}: re-ask repeats the question`);
  }
});

test('the bank keeps every id it had, adds only new ones, and words nothing as Eadwyn’s advice', () => {
  const before = [
    'strat_thesis', 'strat_portfolio_fit', 'trust_reliability', 'trust_confidentiality', 'network_depth', 'network_activation',
    'exec_hands_on', 'exec_bandwidth', 'collab_style', 'collab_founder_led', 'rep_track_record', 'rep_conduct',
    'skill_product', 'skill_finance_ops', 'skill_legal', 'val_benevolence', 'val_self_direction', 'val_universalism',
    'arch_illustration', 'axal_integrity', 'axal_stewardship', 'axal_curiosity', 'axal_resilience', 'axal_collaboration', 'axal_ambition',
  ];
  const keys = new Set(BANK.map(key));
  for (const k of before) assert.ok(keys.has(k), `${k} was removed or renamed`);
  assert.equal(keys.size, BANK.length, 'a key is used twice');
  for (const q of BANK) {
    const text = [q.prompt, q.hint, q.reask_prompt, ...(q.choices || []).map((c) => c.label)].join(' ');
    assert.doesNotMatch(text, /\b(advice|recommendation|fiduciary)\b/i, key(q));
  }
});
