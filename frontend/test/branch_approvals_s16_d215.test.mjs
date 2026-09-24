/**
 * S16 (D215) on the page: the lane chips narrow the one list, every new lane
 * has a console to go to, and the board says which canvas lanes it leaves out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE = readFileSync(resolve(process.cwd(), 'frontend/src/pages/branch/BranchApprovals.jsx'), 'utf8');
const SOURCES = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/approvalSources.ts'), 'utf8');

test('every lane the worker sends has an entry in LANE_CONSOLE', () => {
  // A lane missing here would render "no console" on real work that HAS one.
  const keys = [...SOURCES.matchAll(/^\s{4}key: '([a-z_]+)',$/gm)].map((m) => m[1]);
  assert.equal(keys.length, 11, `expected eleven lanes, found ${keys.join(', ')}`);
  const block = PAGE.slice(PAGE.indexOf('const LANE_CONSOLE'), PAGE.indexOf('const VIEWS'));
  for (const k of keys) assert.match(block, new RegExp(`\\n\\s+${k}: `), `${k} has no LANE_CONSOLE entry`);
});

test('the chips filter the list rather than decorating it', () => {
  assert.match(PAGE, /onClick=\{\(\) => setLaneFilter\(/);
  assert.match(PAGE, /aria-pressed=\{laneFilter === ln\.key\}/);
  assert.match(PAGE, /boardItems\.filter\(\(it\) => it\.lane === laneFilter\)/);
});

test('the lanes the board leaves out are shown with their reasons', () => {
  assert.match(PAGE, /data-testid="branch-board-not-laned"/);
  assert.match(PAGE, /board\.not_laned\.map/);
});

test('the copy no longer counts four queues', () => {
  assert.ok(!/All four queues|Four queues that were four consoles/.test(PAGE));
});
