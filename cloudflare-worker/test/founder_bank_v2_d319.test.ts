/**
 * D319 — the founder fit bank v2 (Profiling v2, Session 9;
 * documentation/architecture/PROFILING_V2.md §3–§6).
 *
 * Against the real bank and the real v2 engine (archetypeScoring.ts, D357):
 *   1. THE PERSONAS. The four founder personas of the Session 6 fixture
 *      classify to their archetype from their answers to THIS bank's own
 *      questions; the Rocketeer/Maverick blend reports both; and on every
 *      pick-one each persona chose the option that speaks for its archetype.
 *   2. THE ADAPTIVE RUN. Answering in the order adaptive selection gives,
 *      each persona reaches every module's floor in about 23 answers, and the
 *      archetype is already right at that point.
 *   3. ACQUIESCENCE. 5 to everything, or always the first option, is not a
 *      confident archetype.
 *   4. SHAPE. Every radar axis has an item; every founder spectrum and every
 *      Schwartz value has one; two reverse-keyed probes per trait; three
 *      pick-ones per close pair; re-ask wording on every item; no v1 id lost.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/founder_bank_v2_d319.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIT_FOUNDER_BANK } from '../src/services/advisor/banks/fit_founder.ts';
import {
  ARCHETYPES_PROFILE_V2, ARCHETYPE_TRAITS, classifyLedgerV2, classifyProfileV2, scoringItemsFor,
  type LedgerAnswer,
} from '../src/services/archetypeScoring.ts';
import { computeProfilingCompletion, selectAdaptiveProfiling } from '../src/services/advisor/profilingModules.ts';
import { RADAR_AXES } from '../src/services/skillsTaxonomySchema.ts';

const FIXTURE = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/test/fixtures/profiling-v2-personas.json'), 'utf8'));
const FOUNDERS = FIXTURE.personas.filter((p: any) => p.role === 'founder' && p.kind === 'archetype');
const BLEND = FIXTURE.personas.find((p: any) => p.key === 'rocket_maverick');
const ITEMS = scoringItemsFor('founder');
const BANK = FIT_FOUNDER_BANK;
const DEFS = ARCHETYPES_PROFILE_V2.founder;

const ledgerOf = (p: any): LedgerAnswer[] =>
  p.answers.map((a: any) => ({ question_id: a.question_id, value: String(a.value), answered_at: a.answered_at }));
const after = (ledger: LedgerAnswer[]) => Math.max(...ledger.map((a) => Date.parse(a.answered_at))) + 1000;

/** Which archetype a set of option loadings speaks for: nearest centroid over the loaded traits. */
function archetypeOf(loadings: Record<string, number>): string {
  const traits = Object.keys(loadings);
  let best = { slug: '', d: Infinity };
  for (const def of DEFS) {
    const d = traits.reduce((s, t) => s + (loadings[t] - (def.centroid as any)[t]) ** 2, 0);
    if (d < best.d) best = { slug: def.slug, d };
  }
  return best.slug;
}

/* 1 · the personas ------------------------------------------------------- */

test('D319: the four founder personas classify to their archetype from this bank’s answers', () => {
  assert.equal(FOUNDERS.length, 4);
  for (const p of FOUNDERS) {
    const ledger = ledgerOf(p);
    // They answered the new items, not only the v1 probes.
    assert.ok(ledger.some((a) => a.question_id === 'fit.founder.arch_fo_pick_contract'), `${p.key} never met a pick-one`);
    assert.ok(ledger.some((a) => a.question_id === 'fit.founder.arch_fo_rev_builder_describe'), `${p.key} never met a reverse key`);
    const c = classifyLedgerV2('founder', ITEMS, ledger, after(ledger))!;
    assert.equal(c.primary, p.expected.primary, `${p.key} classified as ${c.primary}`);
    assert.equal(c.secondary, null, `${p.key} reads as a blend with ${c.secondary}`);
    assert.ok(c.confident, `${p.key} is not confident (${c.confidence})`);
  }
});

test('D319: the Rocketeer/Maverick blend reports both archetypes', () => {
  const ledger = ledgerOf(BLEND);
  const c = classifyLedgerV2('founder', ITEMS, ledger, after(ledger))!;
  assert.equal(c.primary, 'fo_rocketeer');
  assert.equal(c.secondary, 'fo_maverick');
  assert.ok(c.blend);
});

test('D319: on every pick-one, each persona chose the option that speaks for its archetype', () => {
  const picks = BANK.filter((q) => q.choices);
  for (const p of FOUNDERS) {
    const mine = p.expected.primary;
    for (const q of picks) {
      const own = q.choices!.find((c) => archetypeOf(c.loadings as any) === mine);
      if (!own) continue; // this item does not offer the persona's archetype
      const chosen = p.answers.find((a: any) => a.question_id === q.id)?.value;
      const opt = q.choices!.find((c) => c.key === chosen);
      assert.ok(opt, `${p.key}: no answer to ${q.id}`);
      assert.equal(archetypeOf(opt!.loadings as any), mine,
        `${p.key} chose "${opt!.label}" on ${q.id}, which now speaks for ${archetypeOf(opt!.loadings as any)}`);
    }
  }
});

/* 2 · the adaptive run --------------------------------------------------- */

test('D319: answering in adaptive order reaches every floor in ~23 answers, with the archetype already right', () => {
  const byId = new Map(BANK.map((q) => [q.id, q]));
  for (const p of FOUNDERS) {
    const given = new Map<string, string>(p.answers.map((a: any) => [a.question_id, String(a.value)]));
    const answered = new Set<string>();
    const ledger: LedgerAnswer[] = [];
    let t = Date.parse('2026-09-01T09:00:00Z');
    for (let turn = 0; turn < BANK.length; turn++) {
      if (computeProfilingCompletion(BANK, answered).complete) break;
      const next = selectAdaptiveProfiling(BANK, answered)[0];
      assert.ok(next, `${p.key}: the queue ran dry before the floors`);
      // The persona's own answer where the fixture has one; a neutral 3 on the
      // skill, value and Axal items the fixture does not cover.
      const value = given.get(next.id) ?? (next.choices ? next.choices[0].key : '3');
      answered.add(next.id);
      ledger.push({ question_id: next.id, value, answered_at: new Date(t += 60_000).toISOString() });
    }
    const done = computeProfilingCompletion(BANK, answered);
    assert.ok(done.complete, `${p.key}: floors not reached`);
    assert.ok(answered.size <= 25, `${p.key}: took ${answered.size} answers to reach the floors`);
    const arch = [...answered].filter((id) => byId.get(id)!.measures?.archetype_trait || byId.get(id)!.measures?.archetype_choice);
    const traitsSeen = new Set(arch.map((id) => byId.get(id)!.measures!.archetype_trait).filter(Boolean));
    assert.equal(traitsSeen.size, 4, `${p.key}: the floor was reached without every trait`);
    assert.ok(arch.some((id) => byId.get(id)!.choices), `${p.key}: no pick-one before the floor`);
    const c = classifyLedgerV2('founder', ITEMS, ledger, t + 1000)!;
    assert.equal(c.primary, p.expected.primary, `${p.key} at the floor reads as ${c.primary}`);
  }
});

/* 3 · acquiescence ------------------------------------------------------- */

test('D319: 5 to everything, or always the first option, is not a confident archetype', () => {
  const at = '2026-09-01T09:00:00Z';
  const scales = BANK.filter((q) => q.measures?.archetype_trait);
  const picks = BANK.filter((q) => q.choices);
  const all5 = scales.map((q) => ({ question_id: q.id, value: '5', answered_at: at }));
  const first = picks.map((q) => ({ question_id: q.id, value: q.choices![0].key, answered_at: at }));
  const ms = Date.parse(at) + 1000;
  for (const [name, ledger] of [['all 5s', all5], ['all 5s and first options', [...all5, ...first]], ['first options', first], ['all 0s', scales.map((q) => ({ ...all5[0], question_id: q.id, value: '0' }))]] as const) {
    const c = classifyLedgerV2('founder', ITEMS, ledger as LedgerAnswer[], ms)!;
    assert.equal(c.confident, false, `${name} produced a confident ${c.primary} (${c.confidence})`);
  }
  // The first options are not one archetype in disguise.
  assert.ok(new Set(picks.map((q) => archetypeOf(q.choices![0].loadings as any))).size >= 3);
});

/* 4 · shape -------------------------------------------------------------- */

test('D319: every radar axis, every founder spectrum and every Schwartz value has a founder item', () => {
  const axes = new Set(BANK.map((q) => q.measures?.skill_axis).filter(Boolean));
  for (const a of RADAR_AXES) assert.ok(axes.has(a.slug), `no founder item on ${a.slug}`);
  const count = (dim: string) => BANK.filter((q) => q.measures?.value_dim === dim).length;
  for (const dim of ['founder_mission_vs_profit', 'founder_speed_vs_quality', 'founder_risk_appetite', 'founder_growth_vs_sustain', 'founder_autonomy_vs_structure']) {
    assert.ok(count(dim) >= 2, `${dim}: needs its v1 item and a situational one`);
  }
  for (const dim of ['schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism', 'schwartz_self_direction']) {
    assert.equal(count(dim), 1, `${dim}`);
  }
  for (const v of ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition']) {
    assert.equal(BANK.filter((q) => q.measures?.axal_value === v).length, 2, `${v}: v1 self-rating plus a situation`);
  }
  // The v1 red-flag probes stay where they were.
  for (const k of ['blame_shifting', 'transactional', 'ego_over_collaboration', 'poor_follow_through', 'overconfidence', 'weak_ethics']) {
    assert.equal(BANK.filter((q) => q.measures?.red_flag?.key === k).length, 1, `red flag ${k}`);
  }
});

test('D319: two reverse-keyed probes per trait, and three pick-ones for each close pair', () => {
  for (const t of ARCHETYPE_TRAITS) {
    assert.ok(BANK.filter((q) => q.reverse && q.measures?.archetype_trait === t).length >= 2, `${t}: fewer than two reverse keys`);
  }
  const offers = (q: any, slug: string) => q.choices.some((c: any) => archetypeOf(c.loadings) === slug);
  const picks = BANK.filter((q) => q.choices);
  assert.ok(picks.filter((q) => offers(q, 'fo_missionary') && offers(q, 'fo_rocketeer')).length >= 3, 'Missionary–Rocketeer');
  assert.ok(picks.filter((q) => offers(q, 'fo_rocketeer') && offers(q, 'fo_maverick')).length >= 3, 'Rocketeer–Maverick');
  // Every option speaks for exactly one archetype, at that archetype's own values.
  for (const q of picks) {
    for (const c of q.choices!) {
      const slug = archetypeOf(c.loadings as any);
      const def = DEFS.find((d) => d.slug === slug)!;
      for (const [t, v] of Object.entries(c.loadings)) assert.equal(v, (def.centroid as any)[t], `${q.id}/${c.key}: ${t}`);
    }
  }
  // A pick-one alone moves the result towards its archetype.
  for (const def of DEFS) {
    const q = picks.find((x) => x.choices!.some((c) => archetypeOf(c.loadings as any) === def.slug))!;
    const opt = q.choices!.find((c) => archetypeOf(c.loadings as any) === def.slug)!;
    const c = classifyProfileV2('founder', { traits: opt.loadings as any, consistency: 1, answers_used: 1 })!;
    assert.equal(c.primary, def.slug, `${q.id}/${opt.key}`);
  }
});

test('D319: every founder item has re-ask wording, nothing is retired, and no v1 id is lost', () => {
  for (const q of BANK) {
    assert.ok(q.reask_prompt && q.reask_prompt.trim().length > 10, `${q.id} has no re-ask wording`);
    assert.ok(!q.retired, `${q.id} is retired`);
  }
  const ids = new Set(BANK.map((q) => q.id));
  assert.equal(ids.size, BANK.length, 'duplicate id');
  for (const k of V1_KEYS) assert.ok(ids.has(`fit.founder.${k}`), `v1 id fit.founder.${k} is gone`);
  // Voice: Eadwyn never offers "advice" or a "recommendation".
  for (const q of BANK) assert.doesNotMatch(`${q.prompt} ${q.hint ?? ''} ${q.reask_prompt}`, /\badvice\b|recommendation|fiduciary/i, q.id);
});

/** The 58 founder ids on main before Session 9 (append-only). */
const V1_KEYS = ['vision_north_star', 'vision_why_now', 'exec_ship_rate', 'exec_prioritization', 'domain_edge', 'domain_customer_proximity', 'coach_feedback', 'coach_seek_help', 'resilience_setbacks', 'resilience_stamina', 'comm_clarity', 'comm_persuasion', 'team_attract', 'team_conflict', 'values_mission', 'values_ethics', 'lean_speed', 'lean_risk', 'lean_growth', 'lean_autonomy', 'skill_engineering', 'skill_design', 'skill_finance_ops', 'arch_builder', 'arch_builder_fix', 'arch_builder_craft', 'arch_builder_ship', 'arch_builder_first', 'arch_visionary', 'arch_visionary_pull', 'arch_visionary_bet', 'arch_visionary_horizon', 'arch_visionary_story', 'arch_connector', 'arch_connector_doors', 'arch_connector_first_call', 'arch_connector_rooms', 'arch_connector_trust', 'arch_operator', 'arch_operator_cadence', 'arch_operator_gap', 'arch_operator_owners', 'arch_operator_repeat', 'arch_fo_independent', 'arch_fo_playbook', 'arch_fo_breakout', 'arch_fo_raise', 'arch_fo_mission_pull', 'arch_fo_conviction', 'arch_fo_systems', 'arch_fo_quality', 'arch_illustration', 'axal_integrity', 'axal_stewardship', 'axal_curiosity', 'axal_resilience', 'axal_collaboration', 'axal_ambition'];
