/**
 * D4531 slice 3 (#4531, section E) — a candidate's results against a baseline's, per case and per model.
 *
 * Pure over rows (`services/agents/skillEvalCompare.ts`). What is held:
 *   - a regression is a pass turned fail on the same case text, model and evaluator, and nothing else;
 *   - a changed case, a changed evaluator, a row from before either was recorded, a not_run, and a pair on one side
 *     only are each named, and none is a regression or an improvement;
 *   - the report is per case and model, with per-model counts, never an aggregate alone;
 *   - `attribution.quality_only` is true only when the case set, the model set and the evaluator are identical.
 *
 * The write paths that stamp the rows and the route that serves this are tested in agent_skill_runs_d1612d and
 * hq_skill_lifecycle_d4160.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_eval_compare_4531_s3.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPARABLE, compareResults, latestPerPair, pairOutcome, type ResultRow } from '../src/services/agents/skillEvalCompare.ts';
import { caseSha } from '../src/services/agents/skillLifecycle.ts';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const row = (o: Partial<ResultRow> = {}): ResultRow => ({
  case_key: 'starter', case_name: 'Starter', case_sha256: A, model_id: 'm1', result: 'pass', evaluator_version: 3, detail: null, run_at: '2026-11-09 10:00:00', ...o,
});

test('a regression is a pass turned fail on the same case text, model and evaluator', () => {
  assert.equal(pairOutcome(row(), row({ result: 'fail' })), 'regressed');
  assert.equal(pairOutcome(row({ result: 'fail' }), row()), 'improved');
  assert.equal(pairOutcome(row(), row()), 'still_pass');
  assert.equal(pairOutcome(row({ result: 'fail' }), row({ result: 'fail' })), 'still_fail');
});

test('a changed case, a changed evaluator or an unrecorded one is not comparable, and is never a regression', () => {
  assert.equal(pairOutcome(row(), row({ result: 'fail', case_sha256: B })), 'case_changed');
  assert.equal(pairOutcome(row(), row({ result: 'fail', evaluator_version: 4 })), 'evaluator_changed');
  assert.equal(pairOutcome(row({ evaluator_version: null }), row({ result: 'fail' })), 'not_recorded');
  assert.equal(pairOutcome(row(), row({ result: 'fail', case_sha256: null })), 'not_recorded');
  // A refusal on either side is not_run: never a pass, a fail, a regression or an improvement.
  assert.equal(pairOutcome(row(), row({ result: 'not_run' })), 'not_run');
  assert.equal(pairOutcome(row({ result: 'not_run' }), row({ result: 'fail' })), 'not_run');
  assert.equal(pairOutcome(undefined, row()), 'only_candidate');
  assert.equal(pairOutcome(row(), undefined), 'only_baseline');
  for (const o of ['case_changed', 'evaluator_changed', 'not_recorded', 'not_run', 'only_baseline', 'only_candidate'] as const) {
    assert.equal(COMPARABLE.has(o), false, o);
  }
});

test('the report is per case and per model, with per-model counts, and lists each regression', () => {
  const baseline = [
    row({ model_id: 'm1' }), row({ model_id: 'm2' }),
    row({ case_key: 'k2', case_name: 'Live', case_sha256: B, model_id: 'm1', result: 'fail' }),
    row({ case_key: 'k2', case_name: 'Live', case_sha256: B, model_id: 'm2' }),
  ];
  const candidate = [
    row({ model_id: 'm1', result: 'fail', detail: 'It left out "37".' }), row({ model_id: 'm2' }),
    row({ case_key: 'k2', case_name: 'Live', case_sha256: B, model_id: 'm1' }),
    row({ case_key: 'k2', case_name: 'Live', case_sha256: B, model_id: 'm2', result: 'not_run' }),
  ];
  const r = compareResults(baseline, candidate);
  assert.equal(r.pairs.length, 4);
  assert.deepEqual(r.pairs.map((p) => [p.case_key, p.model_id, p.outcome]), [
    ['k2', 'm1', 'improved'], ['k2', 'm2', 'not_run'], ['starter', 'm1', 'regressed'], ['starter', 'm2', 'still_pass'],
  ]);
  assert.deepEqual(r.regressions.map((p) => [p.case_name, p.model_id, p.candidate?.detail]), [['Starter', 'm1', 'It left out "37".']]);
  assert.deepEqual([r.by_model.m1.regressed, r.by_model.m1.improved, r.by_model.m2.not_run, r.by_model.m2.still_pass], [1, 1, 1, 1]);
  assert.deepEqual([r.totals.regressed, r.totals.improved, r.totals.not_run, r.totals.still_pass], [1, 1, 1, 1]);
  assert.equal(r.attribution.quality_only, true, 'same cases, models and evaluator: a quality change');
});

test('attribution names what moved: cases added, removed or changed, models, and the evaluator', () => {
  const base = [row(), row({ case_key: 'k2', case_sha256: B })];
  const cases = compareResults(base, [row({ case_sha256: B }), row({ case_key: 'k3', case_sha256: B })]);
  assert.equal(cases.attribution.quality_only, false);
  assert.deepEqual(cases.attribution.cases, { same: false, added: ['k3'], removed: ['k2'], changed: ['starter'] });
  const models = compareResults([row()], [row(), row({ model_id: 'm9' })]);
  assert.deepEqual([models.attribution.quality_only, models.attribution.models.added], [false, ['m9']]);
  const judge = compareResults([row()], [row({ evaluator_version: 4 })]);
  assert.deepEqual([judge.attribution.quality_only, judge.attribution.evaluator.baseline, judge.attribution.evaluator.candidate], [false, [3], [4]]);
  const unknown = compareResults([row({ evaluator_version: null })], [row()]);
  assert.deepEqual([unknown.attribution.quality_only, unknown.attribution.evaluator.not_recorded], [false, true]);
  assert.equal(compareResults([], []).attribution.quality_only, false, 'nothing compared is not a quality change');
});

test('the latest row per case and model is the one compared', () => {
  const rows = [row({ result: 'fail', run_at: '2026-11-09 09:00:00' }), row({ result: 'pass', run_at: '2026-11-09 11:00:00' }), row({ result: 'fail', run_at: '2026-11-09 10:00:00' })];
  assert.equal(latestPerPair(rows).get('starter\u0000m1')?.result, 'pass');
  assert.equal(compareResults([row()], rows).pairs[0].outcome, 'still_pass', 'an earlier fail is not the candidate\'s result');
});

test('caseSha: the same checked case reads the same; a change to its name, input or expectations does not', async () => {
  const k = { name: 'Starter case', input: { records: { a: 1 } }, expect: { must_include: ['x'] } };
  assert.equal(await caseSha(k), await caseSha(structuredClone(k)));
  assert.match(await caseSha(k), /^[0-9a-f]{64}$/);
  for (const changed of [{ ...k, name: 'Other' }, { ...k, input: { records: { a: 2 } } }, { ...k, expect: { must_include: ['y'] } }]) {
    assert.notEqual(await caseSha(changed), await caseSha(k));
  }
});
