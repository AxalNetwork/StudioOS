/**
 * D777 part 4 (#2102): "a member can see which run filled a field and what it
 * cost." The Worker answers each fill's run (part 2); the Market page's Eadwyn
 * mark now says it, and "Not recorded" is never drawn as a zero cost.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_run_line_d777.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillRunLine, runCost } from '../src/lib/fillRun.js';
import { codeOnly } from './_codeOnly.mjs';

const RUN = { usage_log_id: 41, rail_page: 'Founder · Spin-Out Lab · Market', rail_option: 'fill:market', charged_microusd: 1200, est_cost_usd: 0.0009 };

test('the line names the run and what the member was charged, to a fraction of a cent', () => {
  // Mutations checked: micro-USD not divided (a $1,200 charge); two places only (a $0.00 charge).
  assert.equal(fillRunLine(RUN), 'Run: fill:market · charged $0.0012');
  assert.equal(fillRunLine({ ...RUN, charged_microusd: 25_000 }), 'Run: fill:market · charged $0.03');
});

test('an unsettled charge says the estimate; neither says so; no option names the page', () => {
  assert.equal(fillRunLine({ ...RUN, charged_microusd: null }), 'Run: fill:market · estimated $0.0009');
  assert.equal(fillRunLine({ ...RUN, charged_microusd: null, est_cost_usd: null }), 'Run: fill:market · cost not recorded');
  assert.equal(fillRunLine({ ...RUN, rail_option: null }), 'Run: Founder · Spin-Out Lab · Market · charged $0.0012');
});

test('no run is "not recorded", never a zero cost; a read without the field says nothing', () => {
  // Mutation checked: null treated as a run with no cost ("$0.00").
  assert.equal(fillRunLine(null), 'Run: not recorded');
  assert.equal(fillRunLine(undefined), null);
  assert.equal(runCost(null), null);
  assert.equal(runCost(0), '$0.00');
});

test('the Market page\'s Eadwyn mark carries the run line', () => {
  const page = codeOnly(readFileSync('frontend/src/pages/SpinoutLabMarketPage.jsx', 'utf8'));
  const mark = page.slice(page.indexOf('export function FilledMark'), page.indexOf('export function fmtMoney'));
  assert.match(mark, /fillRunLine\(fill\.run\),\s*\]\.filter\(Boolean\)\.join\('\\n'\);/);
  assert.match(page, /import \{ fillRunLine \} from '\.\.\/lib\/fillRun\.js';/);
});
