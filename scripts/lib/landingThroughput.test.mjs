// D5623: capacity arithmetic, complete evidence windows and independently enumerated bisection costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ceilingPerDay, buildsNeeded, runsPerPr, triggerMet, table } from './landingThroughput.mjs';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const days = overrides => Array.from({ length: 14 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, sourceIssue: 5603, afterWaves: true, complete: true, merged: 200, entryToMergeP90Min: 31, runnerMinPerMergedPr: 250, ...overrides }));

test('capacity and peak-build arithmetic reproduce the stated model', () => {
  near(ceilingPerDay({ batch: 1, builds: 5, wallMin: 44.5 }), 161.79775280898878);
  assert.equal(ceilingPerDay({ batch: 1, builds: 5, wallMin: 12 }), 600);
  assert.equal(ceilingPerDay({ batch: 8, builds: 5, wallMin: 12 }), 4800);
  for (const [perDay, builds] of [[300, 7.5], [600, 15], [1000, 25]]) {
    assert.equal(buildsNeeded({ perDay, peak: 3, wallMin: 12, batch: 1 }), builds);
    assert.equal(buildsNeeded({ perDay, peak: 3, wallMin: 12, batch: 8 }), builds / 8);
  }
  assert.equal(ceilingPerDay({ batch: 1, builds: 0, wallMin: 12 }), 0);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => ceilingPerDay({ batch: 1, builds: 5, wallMin: bad }), RangeError);
  assert.throws(() => buildsNeeded({ perDay: 300, peak: 0, wallMin: 12, batch: 1 }), RangeError);
});

test('binary bisection counts both children and divides by successfully merged PRs', () => {
  assert.equal(runsPerPr({ batch: 8, culpritRate: 0 }), 1 / 8);
  assert.equal(runsPerPr({ batch: 1, culpritRate: 0.5 }), 2);
  assert.equal(runsPerPr({ batch: 2, culpritRate: 0.5 }), 2.5);
  // Enumerate every possible culprit set, then execute a separate simulated splitter.
  for (const n of [3, 4]) {
    const q = 0.2; let expectedRuns = 0, expectedMerges = 0;
    for (let mask = 0; mask < 2 ** n; mask++) {
      const bad = Array.from({ length: n }, (_, i) => Boolean(mask & (1 << i)));
      const k = bad.filter(Boolean).length, probability = q ** k * (1 - q) ** (n - k);
      const execute = ids => {
        if (ids.length === 1 || !ids.some(i => bad[i])) return 1;
        const half = Math.floor(ids.length / 2);
        return 1 + execute(ids.slice(0, half)) + execute(ids.slice(half));
      };
      expectedRuns += probability * execute(Array.from({ length: n }, (_, i) => i));
      expectedMerges += probability * (n - k);
    }
    near(runsPerPr({ batch: n, culpritRate: q }), expectedRuns / expectedMerges);
  }
  for (const culpritRate of [-0.1, 1, NaN]) assert.throws(() => runsPerPr({ batch: 8, culpritRate }), RangeError);
  assert.throws(() => runsPerPr({ batch: 1.5, culpritRate: 0.03 }), RangeError);
});

test('trigger requires 14 consecutive complete post-wave scorecard days and strict thresholds', () => {
  assert.equal(triggerMet(days()), true);
  assert.equal(triggerMet(days().slice(1)), false);
  assert.equal(triggerMet(days({ merged: 199 })), false);
  assert.equal(triggerMet(days({ entryToMergeP90Min: 30 })), false);
  assert.equal(triggerMet(days({ merged: 50, entryToMergeP90Min: null, runnerMinPerMergedPr: 251 })), true);
  assert.equal(triggerMet(days({ entryToMergeP90Min: null, runnerMinPerMergedPr: 250 })), false);
  for (const changed of [{ afterWaves: false }, { complete: false }, { sourceIssue: 999 }, { entryToMergeP90Min: null, runnerMinPerMergedPr: null }]) {
    const rows = days(); rows[7] = { ...rows[7], ...changed }; assert.equal(triggerMet(rows), false);
  }
  for (const date of ['2026-12-09', '2026-12-30', '2026-02-30', 'bad']) {
    const rows = days(); rows[7] = { ...rows[7], date }; assert.equal(triggerMet(rows), false);
  }
  const firstIncomplete = days(); firstIncomplete[0].afterWaves = false;
  assert.equal(triggerMet(firstIncomplete), false, 'all 14 windows, including the earliest, are required');
  assert.equal(triggerMet(days().reverse()), true);
  const recentBad = [...days(), { ...days()[0], date: '2026-12-15', merged: 199 }];
  assert.equal(triggerMet(recentBad), false, 'an older qualifying window cannot override the latest day');
  assert.equal(triggerMet(null), false);
});

test('decision record contains the exact computed table and records the settled A decision', () => {
  const doc = readFileSync(new URL('../../documentation/architecture/decisions/D5623.md', import.meta.url), 'utf8');
  assert.equal(doc.split('<!-- throughput-table:start -->\n')[1]?.split('\n<!-- throughput-table:end -->')[0], table());
  assert.match(doc, /\*\*A — stay native\*\*/);
  assert.match(table(), /\| 300 \| 7\.5 \| 0\.9 \| 33402 \|/);
  assert.match(table(), /\| 600 \| 15\.0 \| 1\.9 \| 66804 \|/);
  assert.match(table(), /\| 1000 \| 25\.0 \| 3\.1 \| 111340 \|/);
});
