/**
 * D1143 (#3029, part 2 of #2433) — the Product-market fit engine and its
 * collector. The engine (`services/scoring/pmf.ts`) is pure and is tested on
 * facts written by hand; the collector (`services/scoring/pmfCollector.ts`)
 * runs on real SQLite (the baseline's tables and the Validate migrations), on
 * ventures whose every figure is worked out in the comments beside it. Every
 * venture, person and pain below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/pmf_engine.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  PMF_MODEL_V1, PMF_INPUT_KEYS, STEP_RULES, computePmf, scorePmf, normalise, isStale, stepHref,
  type PmfInputFacts, type PmfInputKey,
} from '../src/services/scoring/pmf.ts';
import { collectPmfInputs, meanGrade } from '../src/services/scoring/pmfCollector.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const TODAY = '2026-10-25';
const M = PMF_MODEL_V1;

// ── The engine, on facts written by hand ────────────────────────────────────

/** One input's facts; every input not given is left out (it reads "Not expected yet"). */
const fact = (key: PmfInputKey, o: Partial<PmfInputFacts> = {}): PmfInputFacts => ({
  key, applies: true, recorded: true, raw: {}, grade: 1, grade_label: 'measured', as_of: '2026-10-01',
  source: { table: 't', rows: 1 }, words: '', reason: null, before_pivot: 0, ...o,
});
const notRecorded = (key: PmfInputKey) => fact(key, { recorded: false, grade: 0, grade_label: 'not_recorded', as_of: null, reason: 'No record' });
/** The ten inputs: the ones given, the rest Not recorded, product pull Not expected yet. */
const ten = (given: PmfInputFacts[]) => PMF_INPUT_KEYS.map((k) => given.find((f) => f.key === k)
  ?? (k === 'product_pull' ? fact(k, { applies: false, recorded: false, grade: 0 }) : notRecorded(k)));

test('model v1 is the published data: ten inputs, weights summing to 100, the floor, the bands and the marks', () => {
  // Mutations checked: a weight changed; the floor at 0.2.
  assert.deepEqual(M.inputs.map((i) => [i.key, i.weight]), [
    ['icp_interviews', 10], ['icp_coverage', 5], ['pain_frequency', 10], ['pain_severity', 10], ['claims_supported', 20],
    ['paying_demand', 15], ['would_pay', 10], ['waitlist', 5], ['experiment_outcomes', 5], ['product_pull', 10],
  ]);
  assert.equal(M.inputs.reduce((a, i) => a + i.weight, 0), 100);
  assert.equal(M.floor, 0.25);
  assert.deepEqual(M.freshness_days, { records: 365, connector: 90 });
  assert.deepEqual(M.inputs.find((i) => i.key === 'product_pull')!.rule, { kind: 'marks', marks: { activation: 0.4, retention: 0.2, survey: 0.4 } });
  assert.ok(Object.isFrozen(M));
});

test('each rule normalises to 0–100: count, share, steps at their edges, marks averaged over the parts recorded', () => {
  // Mutations checked: the count not capped; the steps' `>=` as `>`; a missing part averaged as 0.
  const rule = (k: PmfInputKey) => M.inputs.find((i) => i.key === k)!.rule;
  assert.equal(normalise(rule('icp_interviews'), { n: 3 }), 15, '5 points each');
  assert.equal(normalise(rule('icp_interviews'), { n: 26 }), 100, 'full at 20, capped');
  assert.equal(normalise(rule('icp_interviews'), { n: 0 }), 0, 'a recorded zero is 0');
  assert.equal(normalise(rule('pain_frequency'), { n: 3, of: 10 }), 50, '30% of a 60% mark');
  assert.equal(normalise(rule('pain_severity'), { n: 2, of: 3 }), 95, '66.7% of a 70% mark, 95.2');
  assert.equal(normalise(rule('would_pay'), { n: 1, of: 0 }), null, 'no denominator: no figure, never 0');
  const steps = rule('paying_demand');
  assert.deepEqual([0, 1, 2, 4, 5, 9].map((n) => normalise(steps, { n })), [0, 40, 70, 70, 100, 100]);
  const marks = rule('product_pull');
  // activation 31% of 40% = 0.775; retention 22% of 20% → 1 (capped); survey 38% of 40% = 0.95. Mean 0.908.
  assert.equal(normalise(marks, { parts: { activation: 0.31, retention: 0.22, survey: 0.38 } }), 91);
  assert.equal(normalise(marks, { parts: { activation: 0.2, retention: null, survey: null } }), 50, 'one part recorded: its own 50');
  assert.equal(normalise(marks, { parts: {} }), null);
});

test('Not recorded is never 0: a missing input is left out of the value and the weights renormalise over the inputs present', () => {
  // Hand-worked. ICP interviews n=10 → 50 (weight 10); paying demand n=2 → 70 (weight 15). Every other input
  // Not recorded, product pull Not expected yet.
  //   value      = (10×50 + 15×70) ÷ (10 + 15) = 1550 ÷ 25 = 62 → Fair
  //   confidence = (10×1 + 15×1) ÷ 90 (the weights of the nine inputs that apply) = 0.278 → Low
  //   coverage   = 2 of 9
  // Mutations checked: a Not recorded input read as 0 (value would be 1550 ÷ 90 = 17); the weights not renormalised;
  // product pull's weight left in the confidence denominator (25 ÷ 100 = 0.25).
  const r = computePmf(ten([fact('icp_interviews', { raw: { n: 10 } }), fact('paying_demand', { raw: { n: 2 } })]), M, TODAY);
  assert.equal(r.state, 'scored');
  assert.equal(r.value, 62);
  assert.equal(r.band, 'Fair');
  assert.equal(r.confidence, 0.28);
  assert.equal(r.confidence_word, 'Low');
  assert.deepEqual(r.coverage, { present: 2, applies: 9 });
  const wp = r.inputs.find((i) => i.key === 'would_pay')!;
  assert.deepEqual([wp.state, wp.value, wp.contribution, wp.reason], ['not_recorded', null, null, 'No record']);
  const icp = r.inputs.find((i) => i.key === 'icp_interviews')!;
  assert.equal(icp.contribution, 20, '10 × 50 ÷ 25');
  assert.equal(r.inputs.find((i) => i.key === 'product_pull')!.state, 'not_expected');

  // A recorded zero is a real 0 and does pull the value down: 0 of the signals paid.
  // value = (10×50 + 15×0) ÷ 25 = 20 → Weak.
  const zero = computePmf(ten([fact('icp_interviews', { raw: { n: 10 } }), fact('paying_demand', { raw: { n: 0 } })]), M, TODAY);
  assert.deepEqual([zero.value, zero.band, zero.coverage.present], [20, 'Weak', 2]);
});

test('below the confidence floor the score reads "Not enough recorded": no value, no band', () => {
  // Hand-worked. The same two inputs at Sourced (0.7): confidence = (10×0.7 + 15×0.7) ÷ 90 = 17.5 ÷ 90 = 0.194 < 0.25.
  // Mutations checked: the floor compared with `>` against a confidence exactly at it; the value kept below the floor.
  const low = computePmf(ten([fact('icp_interviews', { raw: { n: 10 }, grade: 0.7 }), fact('paying_demand', { raw: { n: 2 }, grade: 0.7 })]), M, TODAY);
  assert.deepEqual([low.state, low.value, low.band, low.confidence, low.confidence_word], ['not_enough', null, null, 0.19, null]);
  assert.ok(low.inputs.every((i) => i.contribution == null), 'no contribution is drawn without a number');
  // Exactly at the floor: paying demand (15) and waitlist (5) at 1.0, coverage (5) at 0.5 → 22.5 ÷ 90 = 0.25, scored.
  const at = computePmf(ten([fact('paying_demand', { raw: { n: 1 } }), fact('waitlist', { raw: { n: 1, of: 2 } }), fact('icp_coverage', { raw: { n: 1, of: 1 }, grade: 0.5 })]), M, TODAY);
  assert.deepEqual([at.confidence, at.state, at.confidence_word], [0.25, 'scored', 'Low']);
  // Nothing recorded at all: Not enough recorded, never a 0.
  const none = computePmf(ten([]), M, TODAY);
  assert.deepEqual([none.state, none.value, none.confidence, none.coverage], ['not_enough', null, 0, { present: 0, applies: 9 }]);
});

test('a stale input keeps its value but its grade halves: interviews after 365 days, a connector figure after 90', () => {
  // Hand-worked. ICP interviews n=20 (100, weight 10) with its newest record 2025-10-24, 366 days before today.
  //   confidence = 10 × (1.0 ÷ 2) ÷ 90 = 0.056; value 100 is kept.
  // Mutations checked: the window off by a day; the value halved instead of the grade.
  const icp = M.inputs.find((i) => i.key === 'icp_interviews')!;
  const pull = M.inputs.find((i) => i.key === 'product_pull')!;
  assert.equal(isStale(M, icp, '2025-10-25', TODAY), false, '365 days is still fresh');
  assert.equal(isStale(M, icp, '2025-10-24', TODAY), true);
  assert.equal(isStale(M, pull, '2026-07-27', TODAY), false, '90 days');
  assert.equal(isStale(M, pull, '2026-07-26', TODAY), true, '91 days');
  assert.equal(isStale(M, icp, null, TODAY), false);
  const r = computePmf(ten([fact('icp_interviews', { raw: { n: 20 }, as_of: '2025-10-24' })]), M, TODAY);
  const row = r.inputs.find((i) => i.key === 'icp_interviews')!;
  assert.deepEqual([row.value, row.stale, row.grade_factor], [100, true, 0.5]);
  assert.equal(r.confidence, 0.06);
});

test('product pull is "Not expected yet" until a product is live: out of the coverage count and of every weight', () => {
  // Hand-worked. Paying demand n=5 (100, weight 15, Measured).
  //   Not expected yet: confidence 15 ÷ 90 = 0.167, coverage 1 of 9.
  //   Live but not recorded: confidence 15 ÷ 100 = 0.15, coverage 1 of 10.
  // Mutation checked: `applies` ignored (product pull always counted).
  const pending = computePmf(ten([fact('paying_demand', { raw: { n: 5 } })]), M, TODAY);
  assert.deepEqual([pending.confidence, pending.coverage], [0.17, { present: 1, applies: 9 }]);
  const live = computePmf(ten([fact('paying_demand', { raw: { n: 5 } }), fact('product_pull', { recorded: false, grade: 0 })]), M, TODAY);
  assert.deepEqual([live.confidence, live.coverage], [0.15, { present: 1, applies: 10 }]);
  assert.equal(live.inputs.find((i) => i.key === 'product_pull')!.state, 'not_recorded');
  // A Not expected input's figure is never scored, even when it carries one.
  const ignored = computePmf(ten([fact('paying_demand', { raw: { n: 5 } }), fact('product_pull', { applies: false, raw: { parts: { activation: 0.4 } } })]), M, TODAY);
  assert.equal(ignored.inputs.find((i) => i.key === 'product_pull')!.value, null);
});

test('the next steps rank by the gain this model computes: value first, then confidence', () => {
  // Hand-worked. ICP interviews n=10 → 50 (weight 10, Sourced 0.7); paying demand n=1 → 40 (weight 15, Stated 0.4,
  // one letter without its file; with it the grade would be 0.7). Only these two inputs apply.
  //   base:           value (500 + 600) ÷ 25 = 44; confidence (7 + 6) ÷ 25 = 0.52 Medium
  //   ICP interviews: "Interview 5 more people" → n=15 → 75: value (750 + 600) ÷ 25 = 54, so up to +10
  //   paying demand:  "Attach the letter" → grade 0.7: confidence (7 + 10.5) ÷ 25 = 0.70 High, value +0
  // So ICP interviews first. With 2 signals waiting, paying demand's first step is "Confirm the 2 signals waiting"
  // → n=3 → 70: value (500 + 1050) ÷ 25 = 62, up to +18, and it ranks first.
  // Mutations checked: the sort reversed; the confidence tie-break dropped; a step with no gain kept.
  const only = (fs: PmfInputFacts[]) => PMF_INPUT_KEYS.map((k) => fs.find((f) => f.key === k) ?? fact(k, { applies: false, recorded: false }));
  const icp = fact('icp_interviews', { raw: { n: 10 }, grade: 0.7, grade_label: 'sourced' });
  const pay = fact('paying_demand', { raw: { n: 1 }, grade: 0.4, grade_label: 'stated', meta: { to_confirm: 0, unsourced: 1, attach_grade: 0.7 } });
  const r = scorePmf(only([icp, pay]), M, TODAY);
  assert.deepEqual([r.value, r.confidence, r.confidence_word], [44, 0.52, 'Medium']);
  assert.deepEqual(r.steps.map((s) => [s.input, s.text, s.gain.value, s.gain.confidence]), [
    ['icp_interviews', 'Interview 5 more people who fit your ICP', 10, null],
    ['paying_demand', 'Attach the letter to raise confidence', null, { from: 'Medium', to: 'High' }],
  ]);
  assert.equal(r.steps[1].confidence_delta, 0.18);

  const waiting = scorePmf(only([icp, { ...pay, meta: { to_confirm: 2, unsourced: 1, attach_grade: 0.7 } }]), M, TODAY);
  assert.deepEqual(waiting.steps.map((s) => [s.input, s.text, s.gain.value]), [
    ['paying_demand', 'Confirm the 2 signals waiting', 18],
    ['icp_interviews', 'Interview 5 more people who fit your ICP', 10],
  ]);

  // A first proposal that moves nothing gives way to the rule's next one: n=3 (70) with 1 waiting → n=4 is still 70,
  // so the letter's file is the step.
  const flat = scorePmf(only([icp, { ...pay, raw: { n: 3 }, meta: { to_confirm: 1, unsourced: 1, attach_grade: 0.7 } }]), M, TODAY);
  assert.equal(flat.steps.find((s) => s.input === 'paying_demand')!.text, 'Attach the letter to raise confidence');

  // A step that only fills an input in raises coverage, and says so.
  const cover = scorePmf(only([icp, fact('experiment_outcomes', { recorded: false, grade: 0 })]), M, TODAY);
  const exp = cover.steps.find((s) => s.input === 'experiment_outcomes')!;
  assert.deepEqual(exp.gain.coverage, { from: 1, to: 2, of: 2 });
  assert.equal(exp.text, 'Close an experiment and link its result as evidence');
});

test('one fixed rule per input turns its gap into one sentence, linked to its module', () => {
  // Mutations checked: each rule's count (e.g. "Judge the severity on 3" as 2); the session step's module.
  const step = (f: PmfInputFacts) => STEP_RULES[f.key](f, M);
  const first = (f: PmfInputFacts) => step(f)[0]?.text ?? null;
  assert.equal(first(fact('icp_interviews', { raw: { n: 18 } })), 'Interview 2 more people who fit your ICP');
  assert.equal(first(notRecorded('icp_interviews')), 'Log your first interviews with people who fit your ICP');
  const session = step(fact('icp_interviews', { raw: { n: 20 }, grade: 0.82 }));
  assert.deepEqual(session.map((p) => [p.text, p.module]), [['Record your next interview as a session', 'record']]);
  assert.deepEqual(step(fact('icp_interviews', { raw: { n: 20 }, grade: 1 })), [], 'full and measured: nothing to ask');
  assert.equal(first(fact('icp_coverage', { raw: { n: 15, of: 17 } })), 'Record the fit and the segment on 2 interviews');
  assert.equal(first(fact('pain_frequency', { raw: { n: 4, of: 10 }, meta: { top_theme: 'Month-end reconciliation' } })),
    'Hear "Month-end reconciliation" from 2 more ICP interviews', '60% of 10 is 6');
  assert.equal(first(fact('pain_frequency', { raw: { n: 3, of: 7 }, meta: {} })), 'Hear "the top pain" from 2 more ICP interviews', '60% of 7 is 4.2: 5 reach it');
  assert.equal(step(notRecorded('pain_frequency'))[0].module, 'customer-research');
  assert.equal(first(fact('pain_severity', { raw: { n: 2, of: 3 }, meta: { unjudged: 3 } })), 'Judge the severity on 3 interviews');
  assert.equal(first(fact('claims_supported', { raw: { n: 0.75, of: 3 }, meta: { open: 3, fit_unrecorded: [{ code: 'H2', interviews: 1 }], untested: ['H3'], weakest: 'H1' } })),
    'Record the ICP fit on 1 interview behind H2');
  assert.equal(first(fact('claims_supported', { raw: { n: 0.75, of: 3 }, meta: { open: 3, fit_unrecorded: [], untested: ['H3'], weakest: 'H1' } })), 'Link evidence to H3');
  assert.equal(first(fact('claims_supported', { raw: { n: 0.75, of: 1 }, meta: { open: 1, fit_unrecorded: [], untested: [], weakest: 'H1' } })), 'Back H1 with measured evidence');
  assert.equal(first(notRecorded('claims_supported')), 'Write the claim you most need to be true');
  assert.equal(first(fact('paying_demand', { raw: { n: 0 }, meta: {} })), 'Record a paid pilot, a pre-sale or a letter of intent');
  assert.equal(first(fact('paying_demand', { raw: { n: 2 }, meta: { unsourced: 2, attach_grade: 0.7 } })), 'Attach the files to 2 letters and pre-sales');
  assert.equal(first(fact('would_pay', { raw: { n: 1, of: 3 }, meta: { to_confirm: 1 } })), 'Confirm the 1 would-pay signal waiting');
  assert.equal(first(fact('would_pay', { raw: { n: 1, of: 10 }, meta: { to_confirm: 0 } })), 'Ask the next ICP interviews whether they would pay');
  assert.deepEqual(step(fact('would_pay', { raw: { n: 4, of: 10 }, meta: {} })), [], '40% is full');
  assert.equal(first(fact('waitlist', { recorded: false, meta: { bar: null, signups: 86 } })), 'Set the bar for waitlist sign-ups');
  assert.equal(first(fact('waitlist', { raw: { n: 4, of: 10 }, meta: { bar: 10, signups: 4 } })), 'Grow the waitlist to your bar of 10');
  assert.equal(first(fact('experiment_outcomes', { raw: { n: 1, of: 2 } })), null);
  assert.deepEqual(step(fact('product_pull', { recorded: false })), [], 'product pull waits for PostHog (#2409)');
  assert.equal(stepHref('demand-signals', 7), '/validate/demand-signals?project=7');
  assert.equal(stepHref('record', 7), '/validate/record?project=7');
  assert.equal(stepHref('product-roadmap', 7), '/build/product-roadmap?project=7');
});

test('a grade is the mean of the records behind an input, named by the nearest word', () => {
  // Mutation checked: the mean taken as the minimum.
  assert.deepEqual(meanGrade(['measured', 'sourced', 'measured']), { grade: 0.9, grade_label: 'reviewed' });
  assert.deepEqual(meanGrade(['measured', 'sourced', 'stated']), { grade: 0.7, grade_label: 'sourced' });
  assert.deepEqual(meanGrade([]), { grade: 0, grade_label: 'not_recorded' });
});

// ── The collector, on SQLite ────────────────────────────────────────────────

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const sqlOf = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const P = 1, P_CLAIMS = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'discovery_interviews', 'interview_pain_severities', 'pain_groups', 'pain_group_aliases',
    'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets', 'validation_decisions', 'roadmap_okrs',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  db.exec(sqlOf('464_verdict_decisions.sql'));
  db.exec(sqlOf('460_validate_record_stores.sql'));
  db.exec(sqlOf('438_interview_sessions.sql'));
  db.exec(sqlOf('499_github_roadmap.sql'));
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Northwind Labs', 1001), (${P_CLAIMS}, 'Claims venture', 1002)`);
  return db;
}
const env = (db: DatabaseSync): any => ({ DB: d1Over(db) });
const insert = (db: DatabaseSync, table: string, row: Record<string, unknown>) => {
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(row) as any[])).lastInsertRowid);
};
const iv = (db: DatabaseSync, project: number, o: Record<string, unknown>) => insert(db, 'discovery_interviews', {
  project_id: project, interviewee_name: 'Made-up Person', notes: 'Private notes', stage: 'done', done_at: '2026-09-15', ...o,
});
const session = (db: DatabaseSync, project: number, interview: number, status: string) => insert(db, 'interview_sessions', {
  uid: `s-${interview}-${status}`, interview_id: interview, project_id: project, created_by_user_id: 1, channel: 'video', status,
});

/**
 * Northwind Labs. Five held interviews and one booked:
 *   1 strong, segment 1, "Month-end reconciliation", a transcribed session     → Measured
 *   2 partial, segment 1, "month-end reconciliation"                          → Sourced
 *   3 strong, no segment, "Hiring", a reviewed session                         → Measured
 *   4 none, segment 1, "Month-end reconciliation"                              → Sourced
 *   5 fit not recorded, no segment, no pain                                    → Sourced
 *   6 booked (not held), strong
 * Severities: 1 Severe, 2 Mild, 4 Real. One open claim, H1, with no pain link (untested).
 * Demand: a letter of intent for 6,000 with its file (confirmed), a pre-sale for 4,500 with no file (counted), a letter
 * waiting, a would-pay from a session (confirmed), a would-pay waiting, a typed waitlist sign-up, a need-to-have; a
 * pilot paid and verified, and a recurring payment (not a deposit or pilot). The waitlist bar is 10; three customer
 * sign-ups and one investor. Experiments on H1: two done and linked (one supports, one contradicts), one done and not
 * linked, one running and linked.
 */
function northwind(db: DatabaseSync) {
  const seg = insert(db, 'customer_segments', { project_id: P, name: 'Finance leads', name_norm: 'finance leads', source: 'manual' });
  const i1 = iv(db, P, { icp_fit: 'strong', segment_id: seg, pains_json: '["Month-end reconciliation"]' });
  const i2 = iv(db, P, { icp_fit: 'partial', segment_id: seg, pains_json: '["month-end reconciliation"]', done_at: '2026-09-20' });
  const i3 = iv(db, P, { icp_fit: 'strong', pains_json: '["Hiring"]', done_at: '2026-10-02' });
  const i4 = iv(db, P, { icp_fit: 'none', segment_id: seg, pains_json: '["Month-end reconciliation"]' });
  iv(db, P, { icp_fit: null, pains_json: '[]' });
  iv(db, P, { icp_fit: 'strong', stage: 'booked', done_at: null, pains_json: '["Month-end reconciliation"]' });
  session(db, P, i1, 'transcribed');
  session(db, P, i2, 'recording');
  session(db, P, i3, 'reviewed');
  for (const [id, sev] of [[i1, 'severe'], [i2, 'mild'], [i4, 'real']] as const) {
    insert(db, 'interview_pain_severities', { interview_id: id, phrase_norm: 'month-end reconciliation', severity: sev });
  }
  const h1 = insert(db, 'hypotheses', { project_id: P, code: 'H1', claim: 'Finance leads lose two days a month', sort_order: 1 });
  const sig = (o: Record<string, unknown>) => insert(db, 'demand_signals', { project_id: P, signal_date: '2026-09-10', who: 'Made-up Buyer', ...o });
  sig({ kind: 'loi', status: 'confirmed', amount_cents: 600000, evidence_file_key: 'files/loi-1.pdf' });
  sig({ kind: 'pre_sale', status: 'counted', amount_cents: 450000 });
  sig({ kind: 'loi', status: 'to_confirm', amount_cents: 100000 });
  sig({ kind: 'would_pay', status: 'confirmed', source_kind: 'session', signal_date: '2026-10-05' });
  sig({ kind: 'would_pay', status: 'to_confirm', source_kind: 'interview' });
  sig({ kind: 'waitlist', status: 'confirmed' });
  sig({ kind: 'need_to_have', status: 'confirmed' });
  const rev = (o: Record<string, unknown>) => insert(db, 'revenue_entries', { uid: `r-${Math.random()}`, project_id: P, customer: 'Made-up Co', amount_cents: 120000, currency: 'EUR', source: 'manual', ...o });
  rev({ revenue_type: 'pilot', received_on: '2026-09-03', verification: 'verified' });
  rev({ revenue_type: 'recurring', received_on: '2026-10-01', verification: 'verified' });
  insert(db, 'metric_targets', { project_id: P, metric_key: 'waitlist_target', target_value: 10 });
  for (const audience of [null, 'customer', 'customer', 'investor']) {
    insert(db, 'waitlist_signups', { project_id: P, email: `w${Math.random()}@example.test`, audience, created_at: '2026-10-10 09:00:00' });
  }
  const exp = (status: string, direction: string | null) => {
    const x = insert(db, 'hypothesis_experiments', { uid: `x-${Math.random()}`, project_id: P, hypothesis_id: h1, title: 'A made-up test', status, result: 'Private result', updated_at: '2026-10-12 10:00:00' });
    if (direction) insert(db, 'hypothesis_evidence_links', { uid: `e-${x}`, project_id: P, hypothesis_id: h1, kind: 'experiment', ref_id: String(x), direction });
  };
  exp('done', 'supports'); exp('done', 'contradicts'); exp('done', null); exp('running', 'supports');
}

const byKey = (inputs: PmfInputFacts[]) => Object.fromEntries(inputs.map((f) => [f.key, f])) as Record<PmfInputKey, PmfInputFacts>;

test('the collector reads Northwind\'s ten inputs as worked out by hand, and the score from them', async () => {
  // Mutations checked: a booked interview counted as held; a recording session graded Measured; the investor sign-up
  // counted; a recurring payment counted as a pilot; a waiting signal counted; an unlinked or running experiment counted.
  const db = fixture(); northwind(db);
  const { inputs, verdict, pivot_at } = await collectPmfInputs(env(db), P, TODAY);
  const f = byKey(inputs);
  assert.deepEqual(inputs.map((x) => x.key), [...PMF_INPUT_KEYS]);
  assert.equal(verdict, null); assert.equal(pivot_at, null);

  // 1 · ICP interviews: 1, 2, 3 of 5 held → n 3. Grades 1, 0.7, 1 → 0.9.
  assert.deepEqual([f.icp_interviews.raw, f.icp_interviews.grade, f.icp_interviews.as_of], [{ n: 3 }, 0.9, '2026-10-02']);
  assert.equal(f.icp_interviews.words, '3 of 5 held interviews with people who fit, 2 from recorded sessions');
  assert.deepEqual(f.icp_interviews.source, { table: 'discovery_interviews', rows: 5 });
  // 2 · ICP coverage: a fit and a segment on 1, 2, 4 → 3 of 5. Grades 1, 0.7, 1, 0.7, 0.7 → 0.82.
  assert.deepEqual([f.icp_coverage.raw, f.icp_coverage.grade], [{ n: 3, of: 5 }, 0.82]);
  // 3 · Pain frequency: over ICP 1, 2, 3, the top theme is month-end reconciliation, named by 1 and 2 → 2 of 3.
  assert.deepEqual(f.pain_frequency.raw, { n: 2, of: 3 });
  assert.match(String(f.pain_frequency.meta?.top_theme), /^month-end reconciliation$/i);
  // 4 · Pain severity: judged 1 (Severe), 2 (Mild), 4 (Real) → 2 of 3. Interview 3 names a pain, unjudged: 1.
  // Grades 1, 0.7, 0.7 → 0.8.
  assert.deepEqual([f.pain_severity.raw, f.pain_severity.grade, f.pain_severity.meta?.unjudged], [{ n: 2, of: 3 }, 0.8, 1]);
  // 5 · Claims: one open claim, untested → a recorded 0 of 1, its grade × 0 decided = 0.
  assert.deepEqual([f.claims_supported.recorded, f.claims_supported.raw, f.claims_supported.grade], [true, { n: 0, of: 1 }, 0]);
  assert.deepEqual(f.claims_supported.meta?.untested, ['H1']);
  // 6 · Paying demand: the verified pilot, the letter with a file, the counted pre-sale → 3. Grades 1, 0.7, 0.4 → 0.7.
  // One letter waiting; the pre-sale has no file; with it the grade would be (1 + 0.7 + 0.7) ÷ 3 = 0.8.
  assert.deepEqual([f.paying_demand.raw, f.paying_demand.grade, f.paying_demand.grade_label], [{ n: 3 }, 0.7, 'sourced']);
  assert.deepEqual(f.paying_demand.meta, { to_confirm: 1, unsourced: 1, attach_grade: 0.8 });
  assert.deepEqual(f.paying_demand.source, { table: 'demand_signals, revenue_entries', rows: 8 }, 'seven signals and one pilot');
  // 7 · Would pay: 1 confirmed of 3 ICP interviews, from a session → Measured. One waiting.
  assert.deepEqual([f.would_pay.raw, f.would_pay.grade, f.would_pay.meta?.to_confirm], [{ n: 1, of: 3 }, 1, 1]);
  // 8 · Waitlist: 3 customer sign-ups + 1 typed = 4 of the bar of 10. Grades 1, 1, 1, 0.4 → 0.85.
  assert.deepEqual([f.waitlist.raw, f.waitlist.grade], [{ n: 4, of: 10 }, 0.85]);
  // 9 · Experiments: two done and linked, one supports → 1 of 2, typed → Stated 0.4.
  assert.deepEqual([f.experiment_outcomes.raw, f.experiment_outcomes.grade], [{ n: 1, of: 2 }, 0.4]);
  // 10 · Product pull: no release → Not expected yet.
  assert.deepEqual([f.product_pull.applies, f.product_pull.words], [false, 'Not expected yet']);

  // The score, by hand:
  //   values  15, 60, 100 (66.7% of a 60% mark, capped), 95, 0, 70, 83, 40, 50
  //   value = (10×15 + 5×60 + 10×100 + 10×95 + 20×0 + 15×70 + 10×83 + 5×40 + 5×50) ÷ 90 = 4730 ÷ 90 = 52.6 → 53, Fair
  //   confidence = (10×0.9 + 5×0.82 + 10×0.9 + 10×0.8 + 20×0 + 15×0.7 + 10×1 + 5×0.85 + 5×0.4) ÷ 90 = 56.85 ÷ 90 = 0.63, Medium
  const r = scorePmf(inputs, M, TODAY);
  assert.deepEqual([r.state, r.value, r.band, r.confidence, r.confidence_word, r.coverage], ['scored', 53, 'Fair', 0.63, 'Medium', { present: 9, applies: 9 }]);
  // The steps rank by gain. Claims at 0 of 1, "Link evidence to H1", reaches 1 of 1 at the decided grade 0.82: value
  // (4730 + 20×100) ÷ 90 = 74.8 → 75, up to +22 — the largest gain, so first.
  assert.deepEqual([r.steps[0].input, r.steps[0].text, r.steps[0].gain.value], ['claims_supported', 'Link evidence to H1', 22]);
  for (let i = 1; i < r.steps.length; i += 1) assert.ok((r.steps[i - 1].gain.value ?? 0) >= (r.steps[i].gain.value ?? 0), 'ranked by value gain');
});

test('the collector reads no interviewee name, note or quote, and no buyer, customer or experiment text', async () => {
  // Mutation checked: `interviewee_name` or `notes` added back to the interview read.
  const db = fixture(); northwind(db);
  const seen: string[] = [];
  const base = d1Over(db);
  const spy: any = { ...base, prepare: (q: string) => { seen.push(q); return base.prepare(q); } };
  const out = await collectPmfInputs({ DB: spy } as any, P, TODAY);
  const all = seen.join('\n');
  for (const col of ['interviewee_name', 'interviewee_role', 'interviewee_company', 'notes', 'hypotheses_json', 'quote', ' who', 'customer,', 'result', 'x.title', 'claim,', 'reasoning']) {
    assert.ok(!all.includes(col), `no statement selects ${col.trim()}`);
  }
  const text = JSON.stringify(out);
  for (const secret of ['Made-up Person', 'Private notes', 'Made-up Buyer', 'Made-up Co', 'Private result', 'Finance leads lose']) {
    assert.ok(!text.includes(secret), `the result carries no ${secret}`);
  }
});

test('a Pivot drops the records dated before it, and each input says how many it left out', async () => {
  // Hand-worked. Northwind plus an ICP interview held on 2026-05-01 and a paid deposit on 2026-05-02; a Pivot given
  // for the venture on 2026-06-01 (and a later Proceed). Without the Pivot, ICP interviews read 4 and paying demand 4.
  // With it, they read 3 and 3 again, each with 1 left out "before the pivot". A pivot on one claim moves nothing.
  // Mutations checked: the window not applied; a claim's Pivot taken for the venture's; a withheld Pivot taken.
  const db = fixture(); northwind(db);
  iv(db, P, { icp_fit: 'strong', pains_json: '["Hiring"]', done_at: '2026-05-01' });
  insert(db, 'revenue_entries', { uid: 'r-old', project_id: P, customer: 'Made-up Co', amount_cents: 1, currency: 'EUR', source: 'manual', revenue_type: 'deposit', received_on: '2026-05-02', verification: 'manual' });
  const before = byKey((await collectPmfInputs(env(db), P, TODAY)).inputs);
  assert.deepEqual([before.icp_interviews.raw.n, before.paying_demand.raw.n, before.icp_interviews.before_pivot], [4, 4, 0]);

  insert(db, 'validation_decisions', { project_id: P, decision: 'pivot', state: 'withheld', decided_at: '2026-08-01 10:00:00' });
  insert(db, 'validation_decisions', { project_id: P, decision: 'pivot', hypothesis_id: 1, state: 'given', decided_at: '2026-08-02 10:00:00' });
  const ignored = await collectPmfInputs(env(db), P, TODAY);
  assert.equal(ignored.pivot_at, null, 'a withheld Pivot and a claim\'s Pivot are not the venture\'s');

  insert(db, 'validation_decisions', { project_id: P, decision: 'pivot', state: 'given', decided_at: '2026-06-01 10:00:00', superseded_at: '2026-07-01 10:00:00' });
  insert(db, 'validation_decisions', { project_id: P, decision: 'proceed', state: 'given', decided_at: '2026-07-01 10:00:00' });
  const after = await collectPmfInputs(env(db), P, TODAY);
  const f = byKey(after.inputs);
  assert.equal(after.pivot_at, '2026-06-01', 'the Pivot still bounds the records after a later Proceed supersedes it');
  assert.deepEqual([f.icp_interviews.raw.n, f.icp_interviews.before_pivot], [3, 1]);
  assert.deepEqual([f.paying_demand.raw.n, f.paying_demand.before_pivot], [3, 1]);
  assert.equal(f.icp_coverage.raw.of, 5);
  assert.deepEqual(after.verdict && [after.verdict.decision, after.verdict.state, after.verdict.evidence_count], ['proceed', 'given', 0], 'the Verdict is shown, not scored');
});

test('claims: Supported × its strongest evidence ÷ open claims; a claim with no verdict lowers confidence', async () => {
  // Hand-worked. Six held interviews: five strong naming "Late invoices" (group 1), one with no fit naming "Slow
  // approvals" (group 2), all logged by hand (Sourced 0.7).
  //   H1 supports group 1 at pattern → 5 ICP supporters → Supported, weight 0.75
  //   H2 supports group 2            → fit unrecorded on 1 → no verdict
  //   H3 no link                     → untested
  //   value input: 0.75 ÷ 3 = 0.25 → 25. Grade: 0.7 × 1 decided of 3 = 0.233.
  // Mutations checked: strength weights swapped; ÷ decided claims instead of open; the grade not scaled.
  const db = fixture();
  const g1 = insert(db, 'pain_groups', { project_id: P_CLAIMS, title: 'Late invoices' });
  const g2 = insert(db, 'pain_groups', { project_id: P_CLAIMS, title: 'Slow approvals' });
  insert(db, 'pain_group_aliases', { project_id: P_CLAIMS, group_id: g1, phrase_norm: 'late invoices', display_phrase: 'Late invoices' });
  insert(db, 'pain_group_aliases', { project_id: P_CLAIMS, group_id: g2, phrase_norm: 'slow approvals', display_phrase: 'Slow approvals' });
  for (let i = 0; i < 5; i += 1) iv(db, P_CLAIMS, { icp_fit: 'strong', pains_json: '["Late invoices"]' });
  iv(db, P_CLAIMS, { icp_fit: null, pains_json: '["Slow approvals"]' });
  const h = (code: string, order: number) => insert(db, 'hypotheses', { project_id: P_CLAIMS, code, claim: `Claim ${code}`, sort_order: order });
  const h1 = h('H1', 1); const h2 = h('H2', 2); h('H3', 3);
  insert(db, 'hypothesis_pain_links', { hypothesis_id: h1, pain_group_id: g1, direction: 'supports', strength: 'pattern' });
  insert(db, 'hypothesis_pain_links', { hypothesis_id: h2, pain_group_id: g2, direction: 'supports', strength: 'measured' });
  const f = byKey((await collectPmfInputs(env(db), P_CLAIMS, TODAY)).inputs).claims_supported;
  assert.deepEqual([f.raw, f.grade, f.words], [{ n: 0.75, of: 3 }, 0.233, '1 of 3 open claims Supported']);
  assert.deepEqual(f.meta, { open: 3, fit_unrecorded: [{ code: 'H2', interviews: 1 }], untested: ['H3'], weakest: 'H1', decided_grade: 0.7 });
  assert.equal(normalise(M.inputs.find((i) => i.key === 'claims_supported')!.rule, f.raw), 25);
  const step = scorePmf((await collectPmfInputs(env(db), P_CLAIMS, TODAY)).inputs, M, TODAY).steps.find((s) => s.input === 'claims_supported')!;
  assert.deepEqual([step.text, step.module], ['Record the ICP fit on 1 interview behind H2', 'customer-research']);
});

test('Not recorded with its reason when a module holds nothing; a recorded zero when it holds records none of which meet the input', async () => {
  // Mutations checked: an empty venture read as zeros; no bar read as a 0 share; a release that is a prerelease or
  // unpublished taken as a live product.
  const db = fixture();
  const empty = byKey((await collectPmfInputs(env(db), P, TODAY)).inputs);
  for (const k of PMF_INPUT_KEYS.filter((k) => k !== 'product_pull')) {
    assert.equal(empty[k].recorded, false, `${k} is Not recorded`);
    assert.ok(empty[k].reason, `${k} says why`);
  }
  assert.equal(empty.icp_interviews.reason, 'No interview held yet');
  assert.equal(empty.waitlist.reason, 'No bar set');
  assert.equal(computePmf(Object.values(empty), M, TODAY).state, 'not_enough');

  // Records none of which meet the input: two held interviews, neither ICP; two signals, neither paid.
  iv(db, P, { icp_fit: 'none', pains_json: '[]' }); iv(db, P, { icp_fit: 'none', pains_json: '[]' });
  insert(db, 'demand_signals', { project_id: P, kind: 'need_to_have', status: 'confirmed', signal_date: '2026-10-01' });
  insert(db, 'demand_signals', { project_id: P, kind: 'waitlist', status: 'confirmed', signal_date: '2026-10-01' });
  const zero = byKey((await collectPmfInputs(env(db), P, TODAY)).inputs);
  assert.deepEqual([zero.icp_interviews.recorded, zero.icp_interviews.raw.n], [true, 0]);
  assert.deepEqual([zero.paying_demand.recorded, zero.paying_demand.raw.n], [true, 0]);
  assert.equal(zero.paying_demand.words, '0 of 2 demand signals paid or promised with an amount');
  assert.equal(zero.would_pay.recorded, false, 'no ICP interview: would-pay has no denominator');
  assert.match(zero.waitlist.words, /no bar set \(1 sign-up\)/);

  insert(db, 'roadmap_releases', { project_id: P, repository: 'r', tag: 'v0.1', prerelease: 1, published_at: '2026-10-01' });
  insert(db, 'roadmap_releases', { project_id: P, repository: 'r', tag: 'v0.2', prerelease: 0, published_at: null });
  assert.equal(byKey((await collectPmfInputs(env(db), P, TODAY)).inputs).product_pull.applies, false);
  insert(db, 'roadmap_releases', { project_id: P, repository: 'r', tag: 'v1.0', prerelease: 0, published_at: '2026-10-20' });
  const pull = byKey((await collectPmfInputs(env(db), P, TODAY)).inputs).product_pull;
  assert.deepEqual([pull.applies, pull.recorded, pull.reason], [true, false, 'PostHog metrics are not read yet (#2409)']);
});
