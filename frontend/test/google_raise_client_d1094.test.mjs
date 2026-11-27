/**
 * D1094 (#2959, Google Workspace part 5) — Raise's Google writes, each a path
 * and method the Worker serves (`routes/cycle_raise.ts`), the venture in the
 * query as Raise's routes read it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_raise_client_d1094.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

test('sync, accept, dismiss and delete a copy go to the Worker’s four Raise Google routes', async () => {
  const calls = [];
  const raise = makeCycleWrites(async (path, init = {}) => { calls.push([path, init.method || 'GET', init.body ?? null]); return {}; }).raise;
  await raise.googleSync(7);
  await raise.acceptGoogleProposal(7, 3);
  await raise.dismissGoogleProposal(7, 4);
  await raise.deleteGoogleCopy(7, '9/x');
  assert.deepEqual(calls, [
    ['/cycles/raise/google/sync?project=7', 'POST', null],
    ['/cycles/raise/google/proposals/3/accept?project=7', 'POST', null],
    ['/cycles/raise/google/proposals/4/dismiss?project=7', 'POST', null],
    ['/cycles/raise/google/facts/9%2Fx?project=7', 'DELETE', null],
  ]);
});
