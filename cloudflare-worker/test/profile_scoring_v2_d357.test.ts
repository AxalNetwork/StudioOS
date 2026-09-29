/**
 * D357 — Profiling v2 scoring engine + profile history store
 * (documentation/architecture/PROFILING_V2.md; migration 363).
 *
 * On node:sqlite over the baseline's own `users` and `advisor_answers` plus
 * the WHOLE migration 363 (its trigger included):
 *   1. the Session 6 personas: all 16 classify to their archetype from their
 *      target vectors AND from their answer ledgers; both blends report both
 *      archetypes; every evolution checkpoint's displayed and computed
 *      archetype is reproduced by the hysteresis replay;
 *   2. item types: a reverse-keyed 5 pulls a trait the other way; "5 to
 *      everything" is not a confident archetype; a pick-one moves the result
 *      towards the archetype its option loads; bad item declarations fail at
 *      build time; a pick-one stores its option key;
 *   3. ageing, hysteresis and determinism;
 *   4. the history store: one snapshot on first compute, none on an identical
 *      recompute, one on a material change with its trigger and the engine
 *      version; snapshots cannot be rewritten;
 *   5. the "me" routes return the caller's own history only.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/profile_scoring_v2_d357.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  ENGINE_VERSION, PROFILE_V2_PARAMS, ARCHETYPES_PROFILE_V2, ARCHETYPE_TRAITS, computeArchetype,
  ageWeight, classifyLedgerV2, classifyProfileV2, endOfDayMs, latestAnswers, replayDisplayed,
  scoreTraitsV2, scoringItemsFor, type LedgerAnswer, type ScoringItem,
} from '../src/services/archetypeScoring.ts';
import {
  buildProfile, canonicalJson, isMaterialChange, recomputeProfile, loadHistory, skillState,
} from '../src/services/profileHistory.ts';
import { buildFitBank, pickOne, reverseKeyed, normalizeFitAnswer, type FitRowSpec } from '../src/services/advisor/banks/fitShared.ts';
import { BANKS, bankFor, questionById } from '../src/services/advisor/questionBank.ts';
import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import profileRoutes from '../src/routes/profile_history.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/363_profile_snapshots.sql');
const EVIDENCE_MIGRATION = read('cloudflare-worker/sql/migrations/362_skill_evidence.sql');
const FIXTURE = JSON.parse(read('cloudflare-worker/test/fixtures/profiling-v2-personas.json'));
const ADVISOR_ROUTE = read('cloudflare-worker/src/routes/advisor.ts');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ledgerOf = (p: any): LedgerAnswer[] => p.answers.map((a: any) => ({ question_id: a.question_id, value: String(a.value), answered_at: a.answered_at }));

/* ------------------------------------------------------------------ *
 * Minimum test items: per trait two plain probes and one reverse-keyed *
 * probe, and one pick-one separating Missionary from Architect.        *
 * Never registered in a real bank.                                     *
 * ------------------------------------------------------------------ */
const ROWS: FitRowSpec[] = [];
for (const t of ARCHETYPE_TRAITS) {
  ROWS.push({ key: `t_${t}_1`, prompt: `${t} one`, measures: { archetype_trait: t } });
  ROWS.push({ key: `t_${t}_2`, prompt: `${t} two`, measures: { archetype_trait: t } });
  ROWS.push(reverseKeyed({ key: `t_${t}_r`, prompt: `${t} reversed`, trait: t, reask_prompt: `Still true for ${t}?` }));
}
ROWS.push(pickOne({
  key: 't_pick_mission',
  prompt: 'A key hire wants to know why they should join. You…',
  choices: [
    { key: 'cause', label: 'Tell them about the cause and who else is in', loadings: { visionary: 5, connector: 5 } },
    { key: 'system', label: 'Walk them through how the machine will run', loadings: { builder: 5, operator: 5 } },
  ],
  reask_prompt: 'Is that still how you would pitch a hire?',
}));
const QUESTIONS = buildFitBank('founder', ROWS);
const ITEMS: ScoringItem[] = QUESTIONS.map((q) => ({ question_id: q.id, measures: q.measures!, reverse: q.reverse, choices: q.choices }));
const PICK = 'fit.founder.t_pick_mission';
const AT = '2026-06-01T10:00:00Z';
const AT_MS = endOfDayMs('2026-06-01');

/** Answer every item: plain scales `plain`, reverse-keyed scales `rev`, the pick-one `pick`. */
function answers(plain: number, rev: number, pick: string | null, at = AT): LedgerAnswer[] {
  return QUESTIONS.flatMap((q) => {
    if (q.choices) return pick ? [{ question_id: q.id, value: pick, answered_at: at }] : [];
    return [{ question_id: q.id, value: String(q.reverse ? rev : plain), answered_at: at }];
  });
}

/* ------------------------------------------------------------------ *
 * 1 · the Session 6 personas                                          *
 * ------------------------------------------------------------------ */

test('each of the 16 archetypes is classified as itself from its target vector, confidently', () => {
  for (const persona of ['founder', 'investor', 'partner', 'advisor'] as const) {
    for (const def of ARCHETYPES_PROFILE_V2[persona]) {
      const c = classifyProfileV2(persona, { traits: { ...def.centroid }, consistency: 1, answers_used: 4 })!;
      assert.equal(c.primary, def.slug, `${persona} ${def.slug}`);
      assert.equal(c.distances[def.slug], 0);
      assert.equal(c.confident, true, `${def.slug} confidence ${c.confidence}`);
    }
  }
});

test('the 16 archetype personas classify to their expected archetype from their answer ledgers', () => {
  const personas = FIXTURE.personas.filter((p: any) => p.kind === 'archetype');
  assert.equal(personas.length, 16);
  for (const p of personas) {
    const c = classifyLedgerV2(p.role, scoringItemsFor(p.role), ledgerOf(p), endOfDayMs('2026-12-31'))!;
    assert.equal(c.primary, p.expected.primary, p.key);
  }
});

test('each blend persona reports both archetypes and is flagged a blend', () => {
  const blends = FIXTURE.personas.filter((p: any) => p.kind === 'blend');
  assert.ok(blends.length >= 2);
  for (const p of blends) {
    const c = classifyLedgerV2(p.role, scoringItemsFor(p.role), ledgerOf(p), endOfDayMs('2026-12-31'))!;
    assert.equal(c.primary, p.expected.primary, p.key);
    assert.equal(c.secondary, p.expected.secondary, p.key);
    assert.equal(c.blend, true, p.key);
  }
});

test('the hysteresis replay reproduces every evolution checkpoint (displayed and computed)', () => {
  let n = 0;
  for (const p of FIXTURE.personas.filter((x: any) => x.kind === 'evolution')) {
    for (const ck of p.checkpoints) {
      const r = replayDisplayed(p.role, scoringItemsFor(p.role), ledgerOf(p), ck.at);
      assert.equal(r.displayed, ck.displayed, `${p.key} @ ${ck.at}: displayed`);
      assert.equal(r.computed, ck.computed, `${p.key} @ ${ck.at}: computed`);
      n += 1;
    }
  }
  assert.equal(n, 29);
});

/* ------------------------------------------------------------------ *
 * 2 · item types                                                      *
 * ------------------------------------------------------------------ */

test('a reverse-keyed 5 moves its trait the opposite way to a plain 5', () => {
  const base = answers(3, 2, null); // plain 3, reverse 2 → scored 3: builder sits at 3
  const withPlain5 = base.map((a) => (a.question_id === 'fit.founder.t_builder_1' ? { ...a, value: '5' } : a));
  const withReverse5 = base.map((a) => (a.question_id === 'fit.founder.t_builder_r' ? { ...a, value: '5' } : a));
  const b = (l: LedgerAnswer[]) => scoreTraitsV2(ITEMS, latestAnswers(l, AT_MS), AT_MS).traits.builder as number;
  assert.equal(b(base), 3);
  assert.ok(b(withPlain5) > 3, 'a plain 5 pulls builder up');
  assert.ok(b(withReverse5) < 3, 'a reverse-keyed 5 pulls builder down');
  assert.equal(b(withReverse5), (3 + 3 + 0) / 3);
});

test('answering every scale 5 and every pick-one with its first option is not a confident archetype', () => {
  const c = classifyLedgerV2('founder', ITEMS, answers(5, 5, 'cause'), AT_MS)!;
  assert.equal(c.consistency, 0, 'plain 5s and reverse-keyed 5s contradict each other on every trait');
  assert.equal(c.confident, false);
  assert.ok(c.confidence < PROFILE_V2_PARAMS.confident_at);
  // A consistent person on the same items IS confident.
  const honest = classifyLedgerV2('founder', ITEMS, answers(5, 0, 'cause'), AT_MS)!;
  assert.equal(honest.consistency, 1);
});

test('a pick-one moves the result towards the archetype its chosen option loads', () => {
  const cause = classifyLedgerV2('founder', ITEMS, answers(3, 2, 'cause'), AT_MS)!;
  const system = classifyLedgerV2('founder', ITEMS, answers(3, 2, 'system'), AT_MS)!;
  assert.ok(cause.distances.fo_missionary < system.distances.fo_missionary, 'the cause option is nearer the Missionary');
  assert.ok(system.distances.fo_architect < cause.distances.fo_architect, 'the system option is nearer the Architect');
  assert.ok((cause.traits.visionary as number) > (system.traits.visionary as number));
  assert.ok((system.traits.operator as number) > (cause.traits.operator as number));
  const unknown = classifyLedgerV2('founder', ITEMS, answers(3, 2, 'neither'), AT_MS)!;
  const none = classifyLedgerV2('founder', ITEMS, answers(3, 2, null), AT_MS)!;
  assert.deepEqual(unknown.traits, none.traits, 'an undeclared option key contributes nothing');
});

test('item declarations are held to the spec at build time', () => {
  const bad = (row: FitRowSpec) => () => buildFitBank('founder', [row]);
  const opt = (key: string, label: string, loadings: any) => ({ key, label, loadings });
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('a', 'A', { builder: 5 })] })), /at least two/);
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('a', 'A', { builder: 5 }), opt('a', 'B', { operator: 5 })] })), /duplicate option key/);
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('A-1', 'A', { builder: 5 }), opt('b', 'B', { operator: 5 })] })), /must match/);
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('a', 'A', { builder: 5, visionary: 1, operator: 2 }), opt('b', 'B', { operator: 5 })] })), /one or two traits/);
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('a', 'A', { builder: 6 }), opt('b', 'B', { operator: 5 })] })), /0\.\.5/);
  assert.throws(bad(pickOne({ key: 'x', prompt: 'x', choices: [opt('a', 'A', { flair: 5 }), opt('b', 'B', { operator: 5 })] })), /unknown trait/);
  assert.throws(bad({ key: 'x', prompt: 'x', measures: { skill_axis: 'product' }, reverse: true }), /archetype_trait/);
  assert.throws(bad({ key: 'x', prompt: 'x', measures: { archetype_trait: 'builder', rubric_category: 'values_fit' }, reverse: true }), /nothing else/);
  // A valid pick-one reaches the chat as a plain select over its labels.
  const q = QUESTIONS.find((x) => x.id === PICK)!;
  assert.equal(q.input_kind, 'select');
  assert.deepEqual(q.options, ['Tell them about the cause and who else is in', 'Walk them through how the machine will run']);
  assert.equal(q.measures?.archetype_choice, true);
  assert.equal(q.reask_prompt, 'Is that still how you would pitch a hire?');
});

test('a pick-one answer stores its option key; anything undeclared is refused', async () => {
  const q = QUESTIONS.find((x) => x.id === PICK)!;
  assert.equal(normalizeFitAnswer(q, 'system'), 'system');
  assert.equal(normalizeFitAnswer(q, '  walk them through how the machine will run '), 'system');
  assert.equal(normalizeFitAnswer(q, "'; DROP TABLE users; --"), null);
  assert.equal(normalizeFitAnswer({}, ' 4 '), '4', 'a scale is stored as given');

  // Through the real write router, with the test item registered for the call.
  BANKS.fitFounder.push(q);
  try {
    const env = { DB: null } as any;
    const user = { id: 1, role: 'founder' } as any;
    const ok = await routeAnswer(env, user, PICK, 'Walk them through how the machine will run');
    assert.equal(ok.status, 'saved');
    const refused = await routeAnswer(env, user, PICK, 'something else');
    assert.equal(refused.status, 'invalid');
    assert.match(String(refused.hint), /Tell them about the cause/);
  } finally {
    BANKS.fitFounder.splice(BANKS.fitFounder.indexOf(q), 1);
  }
  // The route writes the KEY (ledgerValue) to the ledger, with the time it was given.
  const batch = ADVISOR_ROUTE.slice(ADVISOR_ROUTE.indexOf('const ledgerValue'), ADVISOR_ROUTE.indexOf('await c.env.DB.batch(stmts);'));
  assert.match(batch, /normalizeFitAnswer\(q, valueStr\)/);
  assert.match(batch, /conv\.id, user\.id, q\.id, ledgerValue,/);
  assert.match(batch, /answered_at = excluded\.answered_at/);
  assert.match(ADVISOR_ROUTE, /await recomputeProfile\(c\.env, user\.id, \{ trigger: 'answer' \}\);/);
});

test('a retired question is not delivered but still scores the answers it has', () => {
  const [retired] = buildFitBank('founder', [{ key: 't_retired_probe', prompt: 'old', measures: { archetype_trait: 'builder' }, retired: { at: '2026-09-28', reason: 'reworded' } }]);
  BANKS.fitFounder.push(retired);
  try {
    assert.ok(!bankFor('founder').some((q) => q.id === retired.id), 'not delivered');
    assert.equal(questionById(retired.id)?.id, retired.id, 'still known');
    assert.ok(scoringItemsFor('founder').some((i) => i.question_id === retired.id), 'still scored');
  } finally {
    BANKS.fitFounder.splice(BANKS.fitFounder.indexOf(retired), 1);
  }
});

test('v1 computeArchetype reads a reverse-keyed probe inverted too, while the card still uses it', async () => {
  const rev = QUESTIONS.find((q) => q.id === 'fit.founder.t_builder_r')!;
  BANKS.fitFounder.push(rev);
  try {
    const db = new DatabaseSync(':memory:');
    db.exec(tableFromBaseline(BASELINE, 'field_sources'));
    db.prepare(`INSERT INTO field_sources (user_id, question_id, evidence_text) VALUES (1, ?, '5')`).run(rev.id);
    const r = await computeArchetype({ DB: d1(db) } as any, 1, 'founder');
    assert.equal(r?.trait_scores.builder, 0, 'a reverse-keyed 5 is a builder 0');
  } finally {
    BANKS.fitFounder.splice(BANKS.fitFounder.indexOf(rev), 1);
  }
});

test('a retired question stops counting once its replacement is answered, and not before', () => {
  const [oldQ, newQ] = buildFitBank('founder', [
    { key: 't_old_builder', prompt: 'old', measures: { archetype_trait: 'builder' }, retired: { at: '2026-09-28', reason: 'reworded', replaced_by: 'fit.founder.t_new_builder' } },
    { key: 't_new_builder', prompt: 'new', measures: { archetype_trait: 'builder' } },
  ]);
  const items: ScoringItem[] = [oldQ, newQ].map((q) => ({ question_id: q.id, measures: q.measures!, replaced_by: q.retired?.replaced_by }));
  const oldOnly: LedgerAnswer[] = [{ question_id: oldQ.id, value: '5', answered_at: AT }];
  const near = (a: unknown, b: number) => Math.abs((a as number) - b) < 1e-9;
  assert.ok(near(scoreTraitsV2(items, latestAnswers(oldOnly, AT_MS), AT_MS).traits.builder, 5), 'still counts while unreplaced');
  const both = [...oldOnly, { question_id: newQ.id, value: '1', answered_at: AT }];
  assert.ok(near(scoreTraitsV2(items, latestAnswers(both, AT_MS), AT_MS).traits.builder, 1), 'the replacement supersedes it');
});

/* ------------------------------------------------------------------ *
 * 3 · ageing, hysteresis, determinism                                 *
 * ------------------------------------------------------------------ */

test('an old answer weighs less than a fresh one, on the spec’s 12-month half-life', () => {
  assert.equal(ageWeight(0), 1);
  assert.equal(ageWeight(365), 0.5);
  assert.equal(ageWeight(730), 0.25);
  assert.ok(ageWeight(30) > ageWeight(200));
  const ledger: LedgerAnswer[] = [
    { question_id: 'fit.founder.t_builder_1', value: '5', answered_at: '2025-06-01T10:00:00Z' }, // a year old
    { question_id: 'fit.founder.t_builder_2', value: '0', answered_at: '2026-06-01T10:00:00Z' }, // fresh
  ];
  const b = scoreTraitsV2(ITEMS, latestAnswers(ledger, AT_MS), AT_MS).traits.builder as number;
  assert.ok(b < 2.5, `the fresh 0 outweighs the year-old 5 (${b})`);
  assert.ok(Math.abs(b - 5 * ageWeight(365) / (ageWeight(365) + 1)) < 0.01);
});

test('the latest answer to a question wins; older ones stay in the ledger but stop counting', () => {
  const ledger: LedgerAnswer[] = [
    { question_id: 'fit.founder.t_builder_1', value: '5', answered_at: '2026-05-01T10:00:00Z' },
    { question_id: 'fit.founder.t_builder_1', value: '1', answered_at: '2026-05-20T10:00:00Z' },
  ];
  assert.equal(scoreTraitsV2(ITEMS, latestAnswers(ledger, AT_MS), AT_MS).traits.builder, 1);
  const before = endOfDayMs('2026-05-10');
  assert.equal(scoreTraitsV2(ITEMS, latestAnswers(ledger, before), before).traits.builder, 5, 'as of 10 May the later answer did not exist');
});

test('a lead that does not hold for the hold period does not move the displayed archetype; one that holds does', () => {
  const missionary = answers(0, 0, null, '2026-01-10T09:00:00Z').map((a) => {
    const t = a.question_id.split('_')[1];
    const v = { builder: 2, visionary: 5, connector: 5, operator: 3 }[t as 'builder'];
    return { ...a, value: String(a.question_id.endsWith('_r') ? 5 - v : v) };
  });
  const architect = (at: string) => missionary.map((a) => {
    const t = a.question_id.split('_')[1];
    const v = { builder: 5, visionary: 2, connector: 2, operator: 5 }[t as 'builder'];
    return { ...a, value: String(a.question_id.endsWith('_r') ? 5 - v : v), answered_at: at };
  });
  const brief = [...missionary, ...architect('2026-03-01T09:00:00Z'), ...missionary.map((a) => ({ ...a, answered_at: '2026-03-10T09:00:00Z' }))];
  assert.equal(replayDisplayed('founder', ITEMS, brief, '2026-03-09').computed, 'fo_architect');
  assert.equal(replayDisplayed('founder', ITEMS, brief, '2026-03-09').displayed, 'fo_missionary', 'nine days is not fourteen');
  assert.equal(replayDisplayed('founder', ITEMS, brief, '2026-04-30').displayed, 'fo_missionary');
  const held = [...missionary, ...architect('2026-03-01T09:00:00Z')];
  assert.equal(replayDisplayed('founder', ITEMS, held, '2026-03-13').displayed, 'fo_missionary', 'day 13');
  const r = replayDisplayed('founder', ITEMS, held, '2026-03-14');
  assert.equal(r.displayed, 'fo_architect', 'day 14');
  assert.equal(r.displayed_since, '2026-03-14');
  assert.deepEqual(replayDisplayed('founder', ITEMS, held, '2026-03-05').pending, { slug: 'fo_architect', since: '2026-03-01' });
});

test('a challenger that holds past the period but leads by less than the margin is not displayed', () => {
  const set = (vals: Record<string, [number, number, number]>, at: string): LedgerAnswer[] =>
    Object.entries(vals).flatMap(([t, [a, b, r]]) => [
      { question_id: `fit.founder.t_${t}_1`, value: String(a), answered_at: at },
      { question_id: `fit.founder.t_${t}_2`, value: String(b), answered_at: at },
      { question_id: `fit.founder.t_${t}_r`, value: String(r), answered_at: at },
    ]);
  // Missionary (2,5,5,3) in January.
  const missionary = set({ builder: [2, 2, 3], visionary: [5, 5, 0], connector: [5, 5, 0], operator: [3, 3, 2] }, '2026-01-10T09:00:00Z');
  // From 1 March: builder 3, visionary 4.33, connector 4.33, operator 2.67 — Rocketeer by about 0.06.
  const narrow = set({ builder: [3, 3, 2], visionary: [4, 4, 0], connector: [4, 4, 0], operator: [3, 3, 3] }, '2026-03-01T09:00:00Z');
  const r = replayDisplayed('founder', ITEMS, [...missionary, ...narrow], '2026-04-30');
  assert.equal(r.computed, 'fo_rocketeer');
  const lead = r.classification!.distances.fo_missionary - r.classification!.distances.fo_rocketeer;
  assert.ok(lead > 0 && lead < PROFILE_V2_PARAMS.lead_margin, `lead ${lead}`);
  assert.equal(r.displayed, 'fo_missionary', 'sixty days ahead by less than the margin is not enough');
  assert.deepEqual(r.pending, { slug: 'fo_rocketeer', since: '2026-03-01' });
});

test('same ledger, evidence and version → byte-identical profile', () => {
  const p = FIXTURE.personas.find((x: any) => x.key === 'partner_radar_grows');
  const ev = { finance_ops: 3.48, marketing_brand: 2 };
  const a = buildProfile('partner', scoringItemsFor('partner'), ledgerOf(p), '2026-09-01', ev);
  const b = buildProfile('partner', scoringItemsFor('partner'), [...ledgerOf(p)], '2026-09-01', { ...ev });
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.engine_version, ENGINE_VERSION);
  assert.equal(a.skills.finance_ops.state, 'corroborated');
  assert.equal(a.skills.marketing_brand.state, 'evidence_only');
  assert.equal(a.skills.engineering.state, 'not_recorded');
  assert.equal(a.skills.engineering.self, null, 'absent is null, never 0');
  assert.equal(a.skills.finance_ops.blended, a.skills.finance_ops.self, 'decision b: evidence corroborates, it does not move the level');
  assert.equal(skillState(4, null), 'self_rated_only');
  assert.equal(skillState(4, 2.99), 'some_evidence');
});

/* ------------------------------------------------------------------ *
 * 4 · the history store                                               *
 * ------------------------------------------------------------------ */

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const r = db.prepare(sql).get(...b); return r ? { ...r } : null; },
        async all() { return { results: db.prepare(sql).all(...b).map((r: any) => ({ ...r })) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'advisor_answers']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)');
  u.run(1, 'fay.founder@example.test', 'founder', 'Fay Founder');
  u.run(2, 'ned.neighbour@example.test', 'founder', 'Ned Neighbour');
  return db;
}
let rowSeq = 0;
function give(db: InstanceType<typeof DatabaseSync>, userId: number, ledger: LedgerAnswer[]) {
  const ins = db.prepare(`INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status, answered_at) VALUES (?, ?, ?, ?, 'saved', ?)`);
  for (const a of ledger) ins.run(1000 + (rowSeq += 1), userId, a.question_id, a.value, a.answered_at);
}
const itemsFor = () => ITEMS;
const snapshots = (db: InstanceType<typeof DatabaseSync>, userId = 1) =>
  db.prepare('SELECT * FROM profile_snapshots WHERE user_id = ? ORDER BY id').all(userId).map((r: any) => ({ ...r }));

test('migration 363 stands alone on the baseline: its tables, CHECKs and the answered_at column', () => {
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(advisor_answers)').all().map((c: any) => c.name);
  assert.ok(cols.includes('answered_at'));
  const ins = db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, traits_json, skills_json, values_json, axal_values_json, computed_at) VALUES (1, ?, 'v', ?, '{}', '{}', '{}', '{}', 'now')`);
  assert.throws(() => ins.run('founder', 'whenever'), /CHECK/);
  assert.throws(() => ins.run('explorer', 'answer'), /CHECK/);
  assert.throws(() => db.prepare('INSERT INTO profile_archetype_publish (user_id, published) VALUES (1, 2)').run(), /CHECK/);
  assert.ok(!/\bBEGIN\s+TRANSACTION\b|\bCOMMIT\b/i.test(MIGRATION.replace(/^\s*--.*$/gm, '')));
});

test('a first compute writes one snapshot; an identical recompute writes none; a material change writes one with its trigger', async () => {
  const db = freshDb();
  const env = { DB: d1(db) } as any;
  give(db, 1, answers(3, 2, 'cause', '2026-06-01T09:00:00Z'));
  const first = await recomputeProfile(env, 1, { trigger: 'answer', asOf: '2026-06-01T10:00:00Z', itemsFor });
  assert.equal(first.length, 1);
  assert.equal(first[0].written, true);
  let rows = snapshots(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trigger_kind, 'answer');
  assert.equal(rows[0].engine_version, ENGINE_VERSION);
  assert.ok(ENGINE_VERSION.length > 0);
  assert.equal(rows[0].persona, 'founder');

  const again = await recomputeProfile(env, 1, { trigger: 'scheduled', asOf: '2026-06-01T11:00:00Z', itemsFor });
  assert.equal(again[0].written, false);
  assert.equal(snapshots(db).length, 1, 'nothing material changed');

  const slightlyLater = await recomputeProfile(env, 1, { trigger: 'scheduled', asOf: '2026-06-20T03:00:00Z', itemsFor });
  assert.equal(slightlyLater[0].written, false, 'nineteen days of uniform ageing is not material');

  give(db, 1, [{ question_id: 'fit.founder.t_operator_1', value: '5', answered_at: '2026-06-21T09:00:00Z' },
    { question_id: 'fit.founder.t_operator_2', value: '5', answered_at: '2026-06-21T09:01:00Z' }]);
  const changed = await recomputeProfile(env, 1, { trigger: 'evidence', asOf: '2026-06-21T10:00:00Z', itemsFor });
  assert.equal(changed[0].written, true);
  rows = snapshots(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].trigger_kind, 'evidence');
  assert.ok(JSON.parse(rows[1].traits_json).operator > JSON.parse(rows[0].traits_json).operator);
});

test('a new engine version is material; the snapshot says which version wrote it', () => {
  const prof = buildProfile('founder', ITEMS, answers(3, 2, 'cause'), '2026-06-01');
  const prev = { ...prof };
  assert.equal(isMaterialChange(prev as any, prof), false);
  assert.equal(isMaterialChange({ ...prev, engine_version: 'profiling-v2.0' } as any, prof), true);
  assert.equal(isMaterialChange({ ...prev, traits: { ...prev.traits, builder: (prev.traits.builder as number) + 0.3 } } as any, prof), true);
  assert.equal(isMaterialChange({ ...prev, traits: { ...prev.traits, builder: (prev.traits.builder as number) + 0.1 } } as any, prof), false);
  assert.equal(isMaterialChange(null, prof), true);
});

test('Session 8’s stored evidence reaches the snapshot, weighted per source, and never becomes a level', async () => {
  const db = freshDb();
  db.exec(EVIDENCE_MIGRATION);
  const ev = db.prepare(`INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at)
                         VALUES (1, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-06-01T03:00:00Z')`);
  ev.run('finance_ops', 'financial_model', 2, 2, 2);        // weight 1
  ev.run('finance_ops', 'cap_table_security', 1, 1, 1);     // weight 1
  ev.run('legal_compliance', 'esign_signed', 4, 4, 4);      // weight 0.5
  ev.run('design', 'brand_site', 1, 1, 1);                  // another user's would not be read
  db.prepare(`INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at)
              VALUES (2, 'product', 'okr_shipped', 9, 9, 9, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-06-01T03:00:00Z')`).run();
  give(db, 1, answers(3, 2, 'cause', '2026-06-01T09:00:00Z'));
  await recomputeProfile({ DB: d1(db) } as any, 1, { trigger: 'evidence', asOf: '2026-06-01T10:00:00Z', itemsFor });
  const skills = JSON.parse(snapshots(db)[0].skills_json);
  assert.deepEqual(skills.finance_ops, { self: null, evidence: 3, blended: null, state: 'evidence_only' });
  assert.equal(skills.legal_compliance.evidence, 2, 'esign_signed counts half');
  assert.equal(skills.product.evidence, null, 'another user’s evidence is not read');
  assert.equal(skills.product.state, 'not_recorded');
});

test('snapshots are append-only: a rewrite is refused by the database', async () => {
  const db = freshDb();
  give(db, 1, answers(3, 2, 'cause', '2026-06-01T09:00:00Z'));
  await recomputeProfile({ DB: d1(db) } as any, 1, { trigger: 'answer', asOf: '2026-06-01T10:00:00Z', itemsFor });
  assert.throws(() => db.prepare("UPDATE profile_snapshots SET displayed_slug = 'fo_maverick'").run(), /append-only/);
});

test('the same ledger, evidence and version write byte-identical snapshots', async () => {
  const one = freshDb();
  const two = freshDb();
  const ledger = answers(4, 1, 'system', '2026-06-01T09:00:00Z');
  give(one, 1, ledger);
  give(two, 1, ledger);
  for (const db of [one, two]) await recomputeProfile({ DB: d1(db) } as any, 1, { trigger: 'answer', asOf: '2026-06-02T10:00:00Z', itemsFor });
  const strip = (r: any) => { const { id: _id, ...rest } = r; return rest; };
  assert.deepEqual(snapshots(one).map(strip), snapshots(two).map(strip));
});

/* ------------------------------------------------------------------ *
 * 5 · the "me" routes                                                 *
 * ------------------------------------------------------------------ */

async function call(db: InstanceType<typeof DatabaseSync>, as: number, method: string, path: string, payload?: unknown) {
  const app = new Hono<any>();
  app.route('/api/profile', profileRoutes);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, { DB: d1(db), JWT_SECRET } as any);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('GET /api/profile/history returns the caller’s own snapshots and nobody else’s', async () => {
  const db = freshDb();
  give(db, 1, answers(3, 2, 'cause', '2026-06-01T09:00:00Z'));
  give(db, 2, answers(5, 0, 'system', '2026-06-01T09:00:00Z'));
  for (const u of [1, 2]) await recomputeProfile({ DB: d1(db) } as any, u, { trigger: 'answer', asOf: '2026-06-01T10:00:00Z', itemsFor });
  const fay = await call(db, 1, 'GET', '/api/profile/history');
  assert.equal(fay.status, 200);
  assert.equal(fay.body.items.length, 1);
  const ned = await call(db, 2, 'GET', '/api/profile/history?persona=founder');
  assert.equal(ned.body.items.length, 1);
  const ownIds = (u: number) => db.prepare('SELECT id FROM profile_snapshots WHERE user_id = ?').all(u).map((r: any) => r.id);
  assert.deepEqual(fay.body.items.map((i: any) => i.id), ownIds(1), 'Fay sees her snapshot');
  assert.deepEqual(ned.body.items.map((i: any) => i.id), ownIds(2), 'Ned sees his');
  assert.notDeepEqual(ownIds(1), ownIds(2));
  const spoof = await call(db, 1, 'GET', '/api/profile/history?user_id=2');
  assert.deepEqual(spoof.body.items.map((i: any) => i.id), ownIds(1), 'a user_id parameter is ignored');
  assert.equal((await call(db, 1, 'GET', '/api/profile/history?persona=admin')).status, 400);
  assert.equal((await loadHistory({ DB: d1(db) } as any, 1, 'investor')).length, 0);
});

test('the archetype publish consent is the caller’s own, false until they set it', async () => {
  const db = freshDb();
  assert.deepEqual((await call(db, 1, 'GET', '/api/profile/archetype-published')).body, { published: false });
  assert.equal((await call(db, 1, 'PUT', '/api/profile/archetype-published', { published: 'yes' })).status, 400);
  assert.deepEqual((await call(db, 1, 'PUT', '/api/profile/archetype-published', { published: true })).body, { published: true });
  assert.deepEqual((await call(db, 1, 'GET', '/api/profile/archetype-published')).body, { published: true });
  assert.deepEqual((await call(db, 2, 'GET', '/api/profile/archetype-published')).body, { published: false }, 'Ned did not publish');
});
