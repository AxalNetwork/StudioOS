/**
 * D5084 (#5084) — HQ › Revenue's Eadwyn suggestions are Revenue's own work: six no-model Ask chips on
 * "Super Admin · Revenue" (summarise the selected period, explain incomplete sources, overdue receivables,
 * open disputes, subsidiary reporting, the AI margin), and the matching one on the Disputes and Statements
 * anchors. None lists a model to pick, so model choice and pricing stay off Revenue's working rail (#5130).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/revenue_ask_chips_5084.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { railOptionsOn } from '../src/services/ai/railMatrix.ts';
import { railOptionJob } from '../src/services/ai/textJobs.ts';

const REVENUE = 'Super Admin · Revenue';
const SIX = ['summarise:period', 'explain:incomplete-sources', 'show:overdue-receivables', 'review:open-disputes', 'compare:subsidiary-reporting', 'explain:ai-margin'];

test('D5084: the Revenue board offers its six finance tasks, in order, and nothing to pick a model with', () => {
  const on = railOptionsOn(REVENUE);
  // Mutation checked: dropping the list from build-rail-matrix's OPTION_LISTS leaves Revenue with none.
  assert.deepEqual(on.map((o) => o.optionKey), SIX);
  for (const o of on) {
    assert.deepEqual([o.handler, o.routeTask, o.models, o.more ?? [], (o as any).noModel], ['none', 'none', [], [], true], o.optionKey);
    assert.equal(railOptionJob(REVENUE, o.optionKey), 'ST1', `${o.optionKey}: answered by Ask Eadwyn`);
  }
  assert.deepEqual(on.map((o) => o.optionLabel), [
    'Summarise the selected period', 'Explain incomplete sources', 'Show overdue receivables',
    'Review open disputes', 'Compare subsidiary reporting', 'Explain the AI margin',
  ]);
});

test('D5084: the Disputes and Statements anchors carry the one task that is theirs; the other Revenue boards none', () => {
  assert.deepEqual(railOptionsOn(`${REVENUE} · Disputes`).map((o) => o.optionKey), ['review:open-disputes']);
  assert.deepEqual(railOptionsOn(`${REVENUE} · Statements`).map((o) => o.optionKey), ['show:overdue-receivables']);
  for (const m of ['Overview', 'Refunds', 'Promotions']) assert.deepEqual(railOptionsOn(`${REVENUE} · ${m}`), [], m);
});
