import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/pages/SpinoutLabUseOfFundsPage.jsx');
const sections = read('../src/components/FundAllocator.jsx').match(/export const FUND_SECTIONS = (\[[\s\S]*?\]);/)[1];
const chunk = page.slice(page.indexOf('export const BUCKETS'), page.indexOf('// Rebalance the other two')).replaceAll('export ', '');
const context = vm.createContext({});
vm.runInContext(`const FUND_SECTIONS = ${sections}; ${chunk}; globalThis.api = {BUCKETS, allocToBuckets, bucketsToUseOfFunds, allocationPatch};`, context);
const {BUCKETS,allocToBuckets,bucketsToUseOfFunds,allocationPatch} = context.api;
const plain = value => JSON.parse(JSON.stringify(value));
test('2462: five recorded sections round-trip without collapsing', () => {
 const stored = BUCKETS.map((b,i) => ({label:b.section,pct:[20,25,15,10,30][i]}));
 assert.deepEqual(JSON.parse(bucketsToUseOfFunds(allocToBuckets(JSON.stringify(stored)))),plain(stored));
});
test('2462: raise edits omit allocations, with and without an existing split', () => {
 for (const stored of ['', JSON.stringify(BUCKETS.map(b => ({label:b.section,pct:20})))]) {
  const patch = {...allocationPatch(false,allocToBuckets(stored),[]),funding_needed:900000};
  assert.equal(Object.hasOwn(patch,'use_of_funds'),false);
 }
 const custom = [{label:'Other recorded section',pct:10}];
 assert.deepEqual(JSON.parse(allocationPatch(true,[20,20,20,20,10],custom).use_of_funds).at(-1),custom[0]);
});
test('2462: clearing a financial driver keeps it empty; explicit zero remains zero', () => {
 const financials = read('../src/pages/FinancialsPage.jsx');
 const source = financials.match(/export function driverValue\(raw\) \{[\s\S]*?\n\}/)[0].replace('export ','');
 const ctx = vm.createContext({});
 vm.runInContext(`${source}; globalThis.parse = driverValue`,ctx);
 assert.equal(ctx.parse(''),''); assert.equal(ctx.parse('0'),0);
 assert.match(financials,/if \(!projectId \|\| !assumptions \|\| missingDriver\) return/);
});
