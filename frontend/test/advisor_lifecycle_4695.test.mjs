/**
 * D4695 (#4695) — the Practice board names the lane and the cycle it read, and reloads when the Worker says the row
 * moved. The Worker's half is cloudflare-worker/test/advisor_lifecycle_4695.test.ts. Each case names its mutations.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisor_lifecycle_4695.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laneMoves } from '../src/pages/advisor/practice/engagementBoard.js';
import { advisorRoutesSource } from './_advisorRoutesSource.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the board offers exactly the moves the Worker\'s state graph allows', () => {
  // Mutations checked: a lane added to the graph without the board; a lane removed from the board only.
  // #4715: the advisor router is advisors.ts plus the route modules it mounts.
  const worker = advisorRoutesSource();
  const graph = worker.slice(worker.indexOf('export const ENGAGEMENT_GRAPH'), worker.indexOf('});', worker.indexOf('export const ENGAGEMENT_GRAPH')));
  for (const [lane, to] of [['drafting', ['proposed', 'signed', 'ended']], ['proposed', ['drafting', 'signed', 'ended']],
    ['signed', ['renewal_due']], ['renewal_due', ['signed']], ['ended', []]]) {
    const line = graph.split('\n').find((l) => l.trim().startsWith(`${lane}:`));
    assert.ok(line, lane);
    const inGraph = [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(inGraph, to, `the Worker's graph for ${lane}`);
    // The board never offers a signed row `ended` (that is the renewal route), so compare the rest.
    assert.deepEqual(laneMoves(lane), to, `the board's moves for ${lane}`);
  }
});

test('an advance carries the lane the board showed, a renewal the term it showed, and a moved row reloads', () => {
  // Mutations checked: expected_lane dropped from the call; expected_cycles dropped; the reload on lane_changed removed.
  const api = read('../src/lib/api.js');
  assert.match(api, /advanceMyAdvisorEngagement: \(id, lane, expectedLane\) =>/);
  assert.match(api, /\.\.\.\(expectedLane \? \{ expected_lane: expectedLane \} : \{\}\)/);
  const zone = read('../src/pages/advisor/practice/EngagementsZone.jsx');
  assert.match(zone, /api\.advanceMyAdvisorEngagement\(e\.id, lane, e\.lane\)/);
  assert.match(zone, /expected_cycles: Number\(e\.cycles \|\| 0\),/);
  assert.match(zone, /error\?\.code === 'lane_changed' \|\| error\?\.code === 'cycles_changed' \|\| error\?\.code === 'term_decided'\) await load\(\)/);
});
