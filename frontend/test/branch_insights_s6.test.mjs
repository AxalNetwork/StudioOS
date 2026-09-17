/**
 * Branch · Insights — canvas S6, and the median that is honest about being
 * absent (D148).
 *
 * WHAT THIS FILE IS FOR. The notice this page replaces promised *"Accounts,
 * activation, programme throughput and revenue share for the quarter, plus a
 * benchmark shown as a single tick against the anonymised platform median."*
 * Two of the four stats have a source and two do not, and the benchmark is —
 * today, with no branch provisioned — an absence. The risk here is a screen
 * that looks complete: four tiles where two are derived from nothing, or a tick
 * against a median of one.
 *
 * So the assertions are aimed at five things:
 *   1. THE TICK IS AGAINST A MEDIAN, NEVER A RANK. The canvas's own words, and
 *      the one thing a comparison screen must not quietly become.
 *   2. THE `n` IS RENDERED. Migration 256 says it exists so the screen can say
 *      "n branches" instead of implying a population it does not know.
 *   3. NO BENCHMARK and AN UNREADABLE ONE are different sentences — D107's rule
 *      on the licence copy, D147's on the template copy, this one's here.
 *   4. THE THREE ABSENCES ARE THE SERVER'S. A page holding its own copy of a
 *      reason is a second place to update, and the one not updated is the one
 *      that lies (D131, D140, D147).
 *   5. NO OTHER TERRITORY IS NAMEABLE. The page must carry no branch list, no
 *      code, no rank — the whole tenancy argument rests on that.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_insights_s6.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const APP = codeOnly(raw('frontend/src/App.jsx'));
const PAGE_RAW = raw('frontend/src/pages/branch/BranchInsights.jsx');
const PAGE = codeOnly(PAGE_RAW);
const API = codeOnly(raw('frontend/src/lib/api.js'));
const WORKER_ROUTE = raw('cloudflare-worker/src/routes/branch_insights.ts');
const WORKER_SERVICE = raw('cloudflare-worker/src/services/branchBenchmarks.ts');
const WORKER_INDEX = raw('cloudflare-worker/src/index.ts');

test('the route renders the page, and the pending notice is gone from it', () => {
  assert.match(
    APP,
    /path="\/branch\/insights" element=\{guard\(\['admin'\], <BranchInsights \/>\)\}/,
  );
  // The window is bounded by the NEXT `<Route`, not a character count:
  // `/branch/settings` legitimately still renders a notice one line down.
  const at = APP.indexOf('path="/branch/insights"');
  assert.ok(at > 0);
  const next = APP.indexOf('<Route', at);
  const element = APP.slice(at, next > at ? next : at + 200);
  assert.ok(element.includes('<BranchInsights />'), 'the window must contain this route\'s element');
  assert.ok(!element.includes('BranchZonePending'), 'the insights route must not still render the notice');
});

test('the page reads one route, and it is the branch\'s own', () => {
  assert.match(PAGE, /api\.branchInsights\(\)/);
  assert.match(API, /branchInsights:\s*\(\)\s*=>\s*request\('\/branch\/insights'\)/);
  // A SECOND FETCH WOULD BE A SECOND COUNT. D128 ended the tile-vs-table
  // disagreement; a page that asked for its stats twice could print two.
  const calls = (PAGE.match(/api\.[a-zA-Z]+\(/g) || []);
  assert.deepEqual(calls, ['api.branchInsights('], 'exactly one api call belongs on this page');
});

test('a tick against a median, never a ranked list — and a rank is UNREPRESENTABLE, not merely absent', () => {
  assert.match(PAGE_RAW, /never a ranked list/, 'the page states the rule it follows');

  // THE FIRST DRAFT OF THIS ASSERTION WAS A BANNED-WORD SCAN, and it failed on
  // correct code: `!PAGE.includes('rank')` forbids the sentence *"never a
  // ranked list"* — the refusal itself. A lexical scan cannot tell a rule from
  // its violation, so this asserts the STRUCTURE instead.
  //
  // A rank needs one of two things: this branch's position among the others, or
  // the others' values. Neither exists to render.
  const ROW = WORKER_SERVICE.slice(
    WORKER_SERVICE.indexOf('export type BenchmarkRow'),
    WORKER_SERVICE.indexOf('};', WORKER_SERVICE.indexOf('export type BenchmarkRow')),
  );
  assert.ok(ROW.length > 40, 'BenchmarkRow must still be declared, or this assertion measures nothing');
  for (const field of ['median_value', 'n_branches', 'period']) {
    assert.ok(ROW.includes(field), `${field} is part of the published row`);
  }
  for (const rankish of ['position', 'percentile', 'rank', 'values', 'per_branch', 'branch_code']) {
    assert.ok(!ROW.includes(rankish),
      `a published row carrying \`${rankish}\` would make a ranked list representable`);
  }

  // And the page holds no per-branch data of its own either.
  assert.ok(!/branch_code|other_branches/.test(PAGE),
    'the median is the only cross-branch figure this page ever sees');
  assert.ok(!/percentile|Percentile/.test(PAGE));
});

test('the denominator is rendered, because a median without one implies a population', () => {
  assert.match(PAGE, /\{b\.n_branches\} branches/,
    'the n travels onto the screen, not just into the payload');
  assert.match(PAGE, /median \{b\.median_value\}/);
  assert.match(PAGE, /\{b\.period\}/, 'a median is about a window and must say which');
});

test('NO BENCHMARK and AN UNREADABLE ONE are different sentences, in that order', () => {
  assert.match(PAGE, /data\?\.benchmarks_available === false/);
  assert.match(PAGE, /claim=\{data\.benchmarks_reason\}/, 'the unreadable case renders the SERVER\'s reason');
  assert.match(PAGE, /reason=\{data\?\.benchmarks_empty_reason\}/, 'and so does the published-nothing case');
  assert.ok(
    PAGE.indexOf('benchmarks_available === false') < PAGE.indexOf('benchmarks.length'),
    'unreadable must be tested before the empty list, or it can never be reached',
  );
});

test('the three stats S6 draws and the branch cannot compute come off the payload', () => {
  assert.match(PAGE, /data\?\.unavailable/);
  assert.match(PAGE, /\(data\.unavailable \|\| \[\]\)\.map/);
  // The reasons are named in the WORKER and only there.
  for (const stat of ['Activation', 'Programme throughput', 'Revenue share for the quarter']) {
    assert.ok(WORKER_ROUTE.includes(`stat: '${stat}'`), `the worker must name ${stat}`);
  }
  assert.ok(
    !PAGE.includes("'Activation'") && !PAGE.includes('"Activation"'),
    'the page must not name the absent stats itself',
  );
});

test('the seats figure carries the server\'s own definition, not a second one', () => {
  assert.match(PAGE, /\{stats\?\.seats_used_basis\}/);
  assert.ok(
    !/Role is not the same thing/.test(PAGE),
    'the page must not restate what the number means — the worker sends the sentence the HQ overview sends',
  );
});

test('the threshold and its argument live in ONE place, and the cron reads them', () => {
  assert.match(WORKER_SERVICE, /export const MIN_BRANCHES = 3;/);
  // The argument for three must be written where the number is, or the next
  // reader changes it as a tuning knob.
  assert.match(WORKER_SERVICE, /n = 2 — the median is the mean of the two/);
  // And the cron must not restate it.
  assert.ok(
    !/MIN_BRANCHES = /.test(WORKER_INDEX),
    'the cron block must read the threshold, never declare a second one',
  );
});

test('the publisher runs on HQ\'s cadence and the function refuses a branch, so neither covers for the other', () => {
  assert.match(WORKER_INDEX, /if \(hqCadences && now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 55\)/,
    'the block is gated on hqCadences — it fans OUT, unlike the sweeps that act on local rows');
  assert.match(WORKER_SERVICE, /if \(branchOf\(env\)\) throw new Error\('publishBenchmarks is only live on HQ'\);/,
    'and the function refuses a branch itself');
});

test('a withheld publish is logged as withheld, not as a success with zero rows', () => {
  assert.match(WORKER_INDEX, /benchmarks withheld/);
  assert.match(WORKER_SERVICE, /withheld_reason/);
});
