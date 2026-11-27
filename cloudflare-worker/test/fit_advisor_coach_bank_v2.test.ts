/**
 * Profiling v2, Session 12 — the advisor and coach fit banks
 * (documentation/architecture/PROFILING_V2.md §2.4, §3, §4, §5, §6).
 *
 * What this holds the two banks to:
 *   * shape: two reverse-keyed probes per trait, at least three pick-ones
 *     that each offer both Hands-On Coach and Accountability Anchor (the
 *     closest pair, 2.45), options that load the archetype they were written
 *     for, a re-ask wording on every item, every radar axis asked, no id lost;
 *   * the fixture's advisor personas, answering these banks' own questions,
 *     classify as themselves in both banks, and the blend persona reports
 *     both archetypes;
 *   * answering in adaptive queue order reaches every module floor with the
 *     archetype already correct;
 *   * agreeing with everything, or always taking the first option, is not a
 *     confident profile.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fit_advisor_coach_bank_v2.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BANKS, BANK_SIZE_TARGETS, bankFor, type Question, type Persona } from '../src/services/advisor/questionBank.ts';
import { computeProfilingCompletion, selectAdaptiveProfiling } from '../src/services/advisor/profilingModules.ts';
import {
  ARCHETYPES_PROFILE_V2,
  ARCHETYPE_TRAITS,
  classifyLedgerV2,
  endOfDayMs,
  scoringItemsFor,
  type LedgerAnswer,
} from '../src/services/archetypeScoring.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';

type Role = 'advisor' | 'coach';
const ROLES: Role[] = ['advisor', 'coach'];
const BANK: Record<Role, Question[]> = { advisor: BANKS.fitAdvisor, coach: BANKS.fitCoach };

const FIXTURE = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/test/fixtures/profiling-v2-personas.json'), 'utf8'));
const ADVISOR_PERSONAS: any[] = FIXTURE.personas.filter((p: any) => p.role === 'advisor' && p.kind === 'archetype');
const BLENDS: any[] = FIXTURE.personas.filter((p: any) => p.role === 'advisor' && p.kind === 'blend');
const AT_MS = endOfDayMs('2026-12-31');
const ledgerOf = (p: any): LedgerAnswer[] => p.answers.map((a: any) => ({ question_id: a.question_id, value: String(a.value), answered_at: a.answered_at }));

const HOC = 'mt_hands_on_coach';
const AA = 'mt_accountability_anchor';
const CENTROID = Object.fromEntries(ARCHETYPES_PROFILE_V2.advisor.map((a) => [a.slug, a.centroid]));

/**
 * Which archetype each pick-one option was written for. This is the authors'
 * intent, read from the labels, and it is what the personas pick by — so a
 * swapped or mistyped loading shows up as a persona or an option test failing.
 */
const INTENT: Record<string, Record<string, string>> = {
  'fit.advisor.arch_mt_pick_missed': { alongside: HOC, recommit: AA, meaning: 'mt_sage_guide', demonstrate: 'mt_craft_master' },
  'fit.advisor.arch_mt_pick_deadline': { checkin: AA, beside: HOC, quality: 'mt_craft_master', picture: 'mt_sage_guide' },
  'fit.advisor.arch_mt_pick_working': { reframe: 'mt_sage_guide', craft: 'mt_craft_master', together: HOC, delivered: AA },
  'fit.advisor.arch_mt_pick_quarter': { teacher: 'mt_craft_master', coach: HOC, anchor: AA, sounding: 'mt_sage_guide' },
  'fit.coach.arch_co_pick_stalled': { work_it: HOC, shrink: AA, question: 'mt_sage_guide', teach: 'mt_craft_master' },
  'fit.coach.arch_co_pick_open': { review: AA, dive_in: HOC, big_q: 'mt_sage_guide', the_work: 'mt_craft_master' },
  'fit.coach.arch_co_pick_close': { new_view: 'mt_sage_guide', new_skill: 'mt_craft_master', moved: HOC, owned: AA },
  'fit.coach.arch_co_pick_more': { review_work: 'mt_craft_master', alongside: HOC, tighter: AA, longer: 'mt_sage_guide' },
};

/** Every id the two banks carried before Session 12. Ids are append-only (§3). */
const BEFORE: Record<Role, string[]> = {
  advisor: [
    'domain_depth', 'domain_recency', 'teach_clarity', 'teach_frameworks', 'listen_questions', 'listen_patience',
    'empathy_walked', 'empathy_pressure', 'reliable_showup', 'reliable_prep', 'values_align', 'values_conflicts',
    'skill_gtm', 'skill_marketing', 'skill_finance_ops', 'skill_capital',
    'val_benevolence', 'val_universalism', 'val_self_direction', 'val_achievement',
    'arch_builder', 'arch_builder_fix', 'arch_builder_craft', 'arch_builder_ship', 'arch_builder_first',
    'arch_visionary', 'arch_visionary_pull', 'arch_visionary_bet', 'arch_visionary_horizon', 'arch_visionary_story',
    'arch_connector', 'arch_connector_doors', 'arch_connector_first_call', 'arch_connector_rooms', 'arch_connector_trust',
    'arch_operator', 'arch_operator_cadence', 'arch_operator_gap', 'arch_operator_owners', 'arch_operator_repeat',
    'arch_mt_craft', 'arch_mt_demo', 'arch_mt_perspective', 'arch_mt_altitude',
    'arch_mt_beside', 'arch_mt_relationship', 'arch_mt_honest', 'arch_mt_cadence', 'arch_illustration',
    'axal_integrity', 'axal_stewardship', 'axal_curiosity', 'axal_resilience', 'axal_collaboration', 'axal_ambition',
  ],
  coach: [
    'domain_method', 'domain_breadth', 'teach_actionable', 'teach_accountability', 'listen_deep', 'listen_nonjudgmental',
    'empathy_founder', 'empathy_holding', 'reliable_consistency', 'reliable_boundaries', 'values_align', 'values_ethics',
    'axal_integrity', 'axal_stewardship', 'axal_curiosity', 'axal_resilience', 'axal_collaboration', 'axal_ambition',
  ],
};

/** The trait each Session 12 scale probe was written for (the authors' intent, read from the prompt). */
const TRAIT_OF: Record<Role, Record<string, string>> = {
  advisor: {
    arch_mt_r_leave_work: 'builder', arch_mt_r_refer_out: 'builder', arch_mt_r_this_week: 'visionary', arch_mt_r_no_direction: 'visionary',
    arch_mt_r_async: 'connector', arch_mt_r_between: 'connector', arch_mt_r_no_next_steps: 'operator', arch_mt_r_let_slide: 'operator',
  },
  coach: {
    arch_co_skill_drill: 'builder', arch_co_own_practice: 'builder', arch_co_meaning: 'visionary', arch_co_possibility: 'visionary',
    arch_co_rapport: 'connector', arch_co_bring_people: 'connector', arch_co_written_goals: 'operator', arch_co_follow_up: 'operator',
    arch_co_r_talk_only: 'builder', arch_co_r_no_demo: 'builder', arch_co_r_present_only: 'visionary', arch_co_r_no_future: 'visionary',
    arch_co_r_arms_length: 'connector', arch_co_r_solo_path: 'connector', arch_co_r_no_tracking: 'operator', arch_co_r_let_drift: 'operator',
  },
};

/** The axis each behavioural skill item names in its key. */
const SKILL_KEY_AXIS: Record<string, string> = {
  skill_b_product: 'product', skill_b_engineering: 'engineering', skill_b_design: 'design', skill_b_gtm: 'gtm_sales',
  skill_b_marketing: 'marketing_brand', skill_b_finance_ops: 'finance_ops', skill_b_legal: 'legal_compliance', skill_b_capital: 'capital_network',
};

const keyOf = (q: Question) => q.id.split('.').slice(2).join('.');
const picks = (role: Role) => BANK[role].filter((q) => q.choices);

/* ------------------------------------------------------------------ *
 * 1 · shape                                                           *
 * ------------------------------------------------------------------ */

test('each bank has two reverse-keyed probes per trait (§3.2)', () => {
  for (const role of ROLES) {
    for (const t of ARCHETYPE_TRAITS) {
      const n = BANK[role].filter((q) => q.reverse && q.measures?.archetype_trait === t).length;
      assert.ok(n >= 2, `${role}: ${n} reverse-keyed ${t} probe(s)`);
    }
  }
});

test('every new scale probe measures the trait it was written for, reverse-keyed exactly when its key says so', () => {
  for (const role of ROLES) {
    for (const [key, trait] of Object.entries(TRAIT_OF[role])) {
      const q = BANK[role].find((x) => keyOf(x) === key);
      assert.ok(q, `${role}: ${key} missing`);
      assert.equal(q!.measures?.archetype_trait, trait, `${role}: ${key}`);
      assert.equal(q!.reverse === true, /_r_/.test(key), `${role}: ${key} reverse flag`);
    }
  }
});

test('coach carries its own archetype module: the 20 shared trait probes and eight coach role probes (§2.4)', () => {
  const coach = new Set(BANK.coach.map(keyOf));
  const shared = BEFORE.advisor.filter((k) => /^arch_(builder|visionary|connector|operator)/.test(k));
  assert.equal(shared.length, 20);
  for (const k of shared) assert.ok(coach.has(k), `coach: ${k} missing`);
  const roleProbes = Object.keys(TRAIT_OF.coach).filter((k) => !/_r_/.test(k));
  assert.equal(roleProbes.length, 8);
  for (const k of roleProbes) assert.ok(coach.has(k), `coach: ${k} missing`);
});

test('each bank has at least three pick-ones, and every one offers both Hands-On Coach and Accountability Anchor', () => {
  for (const role of ROLES) {
    const ps = picks(role);
    assert.ok(ps.length >= 3, `${role}: ${ps.length} pick-ones`);
    for (const q of ps) {
      const intent = INTENT[q.id];
      assert.ok(intent, `${q.id}: no intent recorded in this test`);
      assert.deepEqual(q.choices!.map((c) => c.key).sort(), Object.keys(intent).sort(), `${q.id}: options`);
      const targets = Object.values(intent);
      assert.ok(targets.includes(HOC) && targets.includes(AA), `${q.id}: must offer both of the closest pair`);
      assert.equal(new Set(targets).size, 4, `${q.id}: one option per archetype`);
    }
  }
});

test('every option loads the archetype it was written for: nearest on the traits it loads, and never nearer the pair partner', () => {
  for (const role of ROLES) {
    for (const q of picks(role)) {
      for (const c of q.choices!) {
        const target = INTENT[q.id][c.key];
        const traits = Object.keys(c.loadings) as (keyof typeof c.loadings)[];
        const dist = (slug: string) => Math.sqrt(traits.reduce((s, t) => s + ((c.loadings[t] as number) - (CENTROID[slug] as any)[t]) ** 2, 0));
        const mine = dist(target);
        for (const other of Object.keys(CENTROID)) {
          if (other === target) continue;
          assert.ok(mine < dist(other), `${q.id} / ${c.key}: loads nearer ${other} (${dist(other).toFixed(2)}) than ${target} (${mine.toFixed(2)})`);
        }
      }
    }
  }
});

test('options form a Latin square: each position holds each archetype once, so "always option N" favours none', () => {
  for (const role of ROLES) {
    const ps = picks(role);
    for (let n = 0; n < 4; n += 1) {
      const atN = ps.map((q) => INTENT[q.id][q.choices![n].key]);
      assert.equal(new Set(atN).size, 4, `${role}: option ${n + 1} lands on ${atN.join(', ')}`);
    }
  }
});

test('every item in both banks carries a re-ask wording (§3.2, §7.3)', () => {
  for (const role of ROLES) {
    for (const q of BANK[role]) {
      assert.ok(q.reask_prompt && q.reask_prompt.trim().length > 10, `${q.id}: no reask_prompt`);
      assert.notEqual(q.reask_prompt, q.prompt, `${q.id}: the re-ask repeats the prompt`);
    }
  }
});

test('every radar axis has at least one item in each bank, and each behavioural skill item measures the axis its key names', () => {
  const axes = RADAR_AXES.map((a) => a.slug);
  for (const role of ROLES) {
    const covered = new Set(BANK[role].map((q) => q.measures?.skill_axis).filter(Boolean));
    for (const a of axes) assert.ok(covered.has(a), `${role}: no ${a} item`);
    for (const [key, axis] of Object.entries(SKILL_KEY_AXIS)) {
      const q = BANK[role].find((x) => keyOf(x) === key);
      assert.ok(q, `${role}: ${key} missing`);
      assert.equal(q!.measures?.skill_axis, axis, `${role}: ${key}`);
    }
  }
});

test('values: advisor and coach ask all four Schwartz dimensions by behaviour, and every Axal value has a behavioural variant beside its original', () => {
  for (const role of ROLES) {
    const byKey = new Map(BANK[role].map((q) => [keyOf(q), q]));
    for (const dim of ['benevolence', 'universalism', 'self_direction', 'achievement']) {
      assert.equal(byKey.get(`val_b_${dim}`)?.measures?.value_dim, `schwartz_${dim}`, `${role}: val_b_${dim}`);
    }
    for (const v of ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition']) {
      assert.equal(byKey.get(`axal_b_${v}`)?.measures?.axal_value, v, `${role}: axal_b_${v}`);
      assert.equal(byKey.get(`axal_${v}`)?.measures?.axal_value, v, `${role}: axal_${v} kept`);
    }
    // The red-flag probes stay, and stay ahead of their behavioural variants
    // so adaptive selection still reaches them first.
    const ids = BANK[role].map(keyOf);
    for (const q of BANK[role].filter((x) => x.measures?.red_flag && x.measures.axal_value)) {
      assert.ok(ids.indexOf(keyOf(q)) < ids.indexOf(`axal_b_${q.measures!.axal_value}`), `${q.id}: red-flag probe must precede its variant`);
    }
  }
  const redFlags = (role: Role) => BANK[role].filter((q) => q.measures?.red_flag).map((q) => q.measures!.red_flag!.key).sort();
  assert.deepEqual(redFlags('advisor'), ['blame_shifting', 'ego_over_collaboration', 'overconfidence', 'poor_follow_through', 'transactional', 'transactional']);
  assert.deepEqual(redFlags('coach'), ['blame_shifting', 'ego_over_collaboration', 'poor_follow_through', 'transactional', 'weak_ethics']);
});

test('both banks meet their BANK_SIZE_TARGETS minimums', () => {
  assert.ok(BANK.advisor.length >= BANK_SIZE_TARGETS.fitAdvisor, `advisor ${BANK.advisor.length} < ${BANK_SIZE_TARGETS.fitAdvisor}`);
  assert.ok(BANK.coach.length >= BANK_SIZE_TARGETS.fitCoach, `coach ${BANK.coach.length} < ${BANK_SIZE_TARGETS.fitCoach}`);
});

test('no id was lost: every question the banks carried before Session 12 is still there', () => {
  for (const role of ROLES) {
    const ids = new Set(BANK[role].map(keyOf));
    for (const key of BEFORE[role]) assert.ok(ids.has(key), `${role}: ${key} was removed`);
    assert.equal(ids.size, BANK[role].length, `${role}: duplicate id`);
  }
});

/* ------------------------------------------------------------------ *
 * 2 · personas answering these banks                                  *
 * ------------------------------------------------------------------ */

test('the four advisor personas classify as themselves, confidently, from their answers to each bank', () => {
  assert.equal(ADVISOR_PERSONAS.length, 4);
  for (const role of ROLES) {
    for (const p of ADVISOR_PERSONAS) {
      const c = classifyLedgerV2(role, scoringItemsFor(role), ledgerOf(p), AT_MS)!;
      assert.equal(c.primary, p.expected.primary, `${role} ${p.key}: ${c.primary}`);
      assert.equal(c.confident, true, `${role} ${p.key}: confidence ${c.confidence}`);
      assert.ok(c.consistency >= 0.9, `${role} ${p.key}: consistency ${c.consistency}`);
    }
  }
});

test('the Hands-On Coach and Accountability Anchor personas are told apart by the pick-ones alone', () => {
  for (const role of ROLES) {
    const pickIds = new Set(picks(role).map((q) => q.id));
    const items = scoringItemsFor(role).filter((i) => pickIds.has(i.question_id));
    for (const p of ADVISOR_PERSONAS.filter((x) => x.expected.primary === HOC || x.expected.primary === AA)) {
      const c = classifyLedgerV2(role, items, ledgerOf(p), AT_MS)!;
      assert.equal(c.primary, p.expected.primary, `${role} ${p.key}`);
      const other = p.expected.primary === HOC ? AA : HOC;
      assert.ok(c.distances[other] - c.distances[p.expected.primary] >= 0.5, `${role} ${p.key}: pair margin ${(c.distances[other] - c.distances[p.expected.primary]).toFixed(2)}`);
    }
  }
});

test('the blend persona reports both archetypes in each bank', () => {
  assert.ok(BLENDS.length >= 1);
  for (const role of ROLES) {
    for (const p of BLENDS) {
      const c = classifyLedgerV2(role, scoringItemsFor(role), ledgerOf(p), AT_MS)!;
      assert.equal(c.primary, p.expected.primary, `${role} ${p.key}`);
      assert.equal(c.secondary, p.expected.secondary, `${role} ${p.key}`);
      assert.equal(c.blend, true, `${role} ${p.key}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 3 · adaptive run to the floors                                      *
 * ------------------------------------------------------------------ */

/**
 * Answer the adaptive queue's first question, from the persona's own answer,
 * until nothing is left to ask. The advisor conversation delivers the advisor
 * and coach banks together (bankFor), so the advisor run uses that; the coach
 * run uses the coach bank on its own.
 */
function adaptiveRun(p: any, bank: Question[]) {
  const own = new Map<string, any>(p.answers.map((a: any) => [a.question_id, a]));
  const answered = new Set<string>();
  const ledger: LedgerAnswer[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const next = selectAdaptiveProfiling(bank, answered)[0];
    if (!next) break;
    const a = own.get(next.id);
    assert.ok(a, `${p.key}: the queue asked ${next.id}, which the persona never answered`);
    answered.add(next.id);
    ledger.push({ question_id: a.question_id, value: String(a.value), answered_at: a.answered_at });
  }
  return { answered, ledger, completion: computeProfilingCompletion(bank, answered) };
}

test('answering in queue order reaches every floor in about 23 answers, with the archetype already right', () => {
  const runs: Array<[Role, Question[]]> = [
    ['advisor', bankFor('advisor' as Persona)],
    ['coach', BANK.coach],
  ];
  for (const [role, bank] of runs) {
    for (const p of [...ADVISOR_PERSONAS, ...BLENDS]) {
      const { answered, ledger, completion } = adaptiveRun(p, bank);
      assert.equal(completion.complete, true, `${role} ${p.key}: not every module confident`);
      assert.ok(answered.size <= 25, `${role} ${p.key}: ${answered.size} answers to reach the floors`);
      const archetypeIds = [...answered].filter((id) => bank.find((q) => q.id === id)?.measures?.archetype_trait);
      const traits = new Set(archetypeIds.map((id) => bank.find((q) => q.id === id)!.measures!.archetype_trait));
      assert.equal(traits.size, 4, `${role} ${p.key}: every trait answered at the floor (§4)`);
      // The pick-ones sit ahead of the extra probes, so the pair separation is
      // already in the answers when the archetype module turns confident.
      const pickIds = new Set(picks(role).map((q) => q.id));
      assert.ok([...answered].filter((id) => pickIds.has(id)).length >= 2, `${role} ${p.key}: fewer than two pick-ones at the floor`);
      const c = classifyLedgerV2(role, scoringItemsFor(role), ledger, AT_MS)!;
      assert.ok(c, `${role} ${p.key}: no archetype at the floor`);
      if (p.kind === 'blend') {
        // A blend is two archetypes within secondary_margin of each other; at
        // the floor either may lead, but both must be reported.
        assert.deepEqual([c.primary, c.secondary].sort(), [p.expected.primary, p.expected.secondary].sort(), `${role} ${p.key} at the floor`);
      } else {
        assert.equal(c.primary, p.expected.primary, `${role} ${p.key}: ${c.primary} at the floor`);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * 4 · agreeing with everything is not a profile                       *
 * ------------------------------------------------------------------ */

/** Every scale answered `scale` (null: skipped), every pick-one answered with option `option` (null: skipped). */
function uniform(role: Role, scale: string | null, option: number | null): LedgerAnswer[] {
  const at = '2026-06-01T10:00:00Z';
  return BANK[role].flatMap((q) => {
    if (q.choices) return option === null ? [] : [{ question_id: q.id, value: q.choices[option].key, answered_at: at }];
    if (!q.measures?.archetype_trait || scale === null) return [];
    return [{ question_id: q.id, value: scale, answered_at: at }];
  });
}

test('all 5s, all 0s, or always the same option does not produce a confident archetype', () => {
  for (const role of ROLES) {
    const cases: Array<[string, LedgerAnswer[]]> = [
      ['all 5s', uniform(role, '5', null)],
      ['all 5s and the first option', uniform(role, '5', 0)],
      ['all 0s and the first option', uniform(role, '0', 0)],
      ['the first option only, every scale skipped', uniform(role, null, 0)],
      ['the last option only, every scale skipped', uniform(role, null, 3)],
    ];
    for (const [label, ledger] of cases) {
      const c = classifyLedgerV2(role, scoringItemsFor(role), ledger, AT_MS);
      assert.ok(c, `${role} ${label}: no classification at all`);
      assert.equal(c!.confident, false, `${role} ${label}: confident ${c!.primary} at ${c!.confidence}`);
    }
    // Any single scale value with any fixed option, or any fixed option alone.
    for (const scale of [null, '0', '1', '2', '3', '4', '5']) {
      for (const option of [null, 0, 1, 2, 3]) {
        const ledger = uniform(role, scale, option);
        if (!ledger.length) continue;
        const c = classifyLedgerV2(role, scoringItemsFor(role), ledger, AT_MS)!;
        assert.equal(c.confident, false, `${role} scale ${scale} option ${option}: confident ${c.primary} at ${c.confidence}`);
      }
    }
  }
});
