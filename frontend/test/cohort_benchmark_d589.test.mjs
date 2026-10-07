/**
 * D589 — the benchmark keeps the tier bars and adds the cohort median only
 * when the Worker returned one. The sentence is about the official run the
 * Worker placed, which can differ from a newer practice composite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildScoringEngineViewModel, fmtDate, ordinal } from '../src/lib/scoringViewModel.js';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

test('a ready cohort adds one bar and the percentile sentence; a small cohort adds the reason and no bar', () => {
  const placedOn = '2026-10-01 12:00:00';
  const base = {
    snapshots: [
      { total_score: 80, tier: 'TIER_1', created_at: '2026-10-02 12:00:00', is_sandbox: 1 },
      { total_score: 40, tier: 'TIER_2', created_at: placedOn, is_sandbox: 0 },
    ],
    state: {},
    project: { name: 'Acme' },
    viewerRole: 'founder',
  };
  const ready = buildScoringEngineViewModel({
    ...base,
    cohort: {
      available: true, cohort: 'Cohort 3', week: 3, median: 35, percentile: 30,
      own_score: 40, own_scored_at: placedOn,
    },
  });
  assert.deepEqual(ready.benchmarks.map((b) => b.id), ['you', 'tier2', 'tier1', 'cohort']);
  assert.equal(ready.benchmarks[0].value, 80);
  assert.equal(ready.benchmarks[3].label, 'Cohort 3 median (Week 3)');
  assert.equal(ready.benchmarks[3].value, 35);
  assert.equal(
    ready.cohortSentence,
    `Your official run of 40 on ${fmtDate(placedOn)} ranks in the 30th percentile of the Cohort 3 field.`,
  );
  assert.doesNotMatch(ready.cohortSentence, /80/);
  assert.match(ready.benchmarkCaption, /nearest 5/);
  assert.match(ready.benchmarkCaption, /nearest 10/);
  assert.equal(ready.exportMeta.cohortBar.value, 35);
  assert.equal(ready.exportMeta.cohortLine, ready.cohortSentence);
  assert.equal(ordinal(50), '50th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(2), '2nd');

  const small = buildScoringEngineViewModel({
    ...base,
    cohort: { available: false, reason: 'There are not enough scored ventures in this cohort at this week yet.' },
  });
  assert.deepEqual(small.benchmarks.map((b) => b.id), ['you', 'tier2', 'tier1']);
  assert.match(small.cohortSentence, /not enough scored ventures/);
  assert.equal(small.exportMeta.cohortBar, null);
  assert.doesNotMatch(JSON.stringify(small.benchmarks), /median/);
});

test('the page, the bars and the PDF read the cohort benchmark', () => {
  const page = read('frontend/src/pages/SpinoutLabScoringPage.jsx');
  const bars = read('frontend/src/components/scoring/BenchmarkBars.jsx');
  const pdf = read('frontend/src/lib/scoringReportPdf.js');
  const api = read('frontend/src/lib/api.js');
  assert.match(page, /getCohortBenchmark/);
  assert.match(page, /Promise\.all\(\[\s*api\.getScores\(proj\.id, \{ includeSandbox: true \}\)\.catch\(\(\) => null\),\s*api\.getCohortBenchmark\(proj\.id\)\.catch\(wkOnly\),/);
  assert.match(page, /cohortNote=\{vm\.cohortSentence\}/);
  assert.match(page, /The cohort benchmark/);
  assert.match(page, /The cohort benchmark is not in this environment/);
  assert.match(bars, /text-cohort-benchmark/);
  assert.match(pdf, /cohortBar/);
  assert.match(pdf, /cohortLine/);
  assert.doesNotMatch(pdf, /cohort benchmark positioning — engine tier thresholds are shown instead/);
  assert.match(api, /getCohortBenchmark: \(projectId\) => request\(`\/scoring\/cohort-benchmark\/\$\{encodeURIComponent\(projectId\)\}`\)/);
});
