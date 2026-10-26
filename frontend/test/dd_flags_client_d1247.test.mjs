/**
 * D1247 (#3262) — the client for Due diligence flags: raise, change and the
 * history, against routes/dd.ts. Stubbed fetch only; behaviour is the Worker
 * test's (cloudflare-worker/test/dd_flags_d1247.test.ts).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_flags_client_d1247.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import { ddFlagsApi, DD_FLAG_STATES } from '../src/lib/api/ddFlags.js';
import * as api from '../src/lib/api.js';

async function seen(run) {
  const restoreDoc = installDocument();
  const out = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    out.push([opts.method || 'GET', String(url).replace(/^.*\/api/, ''), opts.body ? JSON.parse(opts.body) : undefined]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = prev; restoreDoc(); }
  return out;
}

test('raise, change and history name their case and flag', async () => {
  const out = await seen(async () => {
    await ddFlagsApi.raise('case 1', { section_id: 2, severity: 'high', title: 'T' });
    await ddFlagsApi.change('case 1', 7, { state: 'closed', resolution: 'R' });
    await ddFlagsApi.history('case 1', 7);
  });
  assert.deepEqual(out, [
    ['POST', '/dd/cases/case%201/findings', { section_id: 2, severity: 'high', title: 'T' }],
    ['PATCH', '/dd/cases/case%201/findings/7', { state: 'closed', resolution: 'R' }],
    ['GET', '/dd/cases/case%201/findings/7/history', undefined],
  ]);
});

test('an unknown state is refused before any request; the states are the Worker\'s', async () => {
  const out = await seen(async () => {
    // Mutation checked: drop the guard → the request is sent.
    assert.throws(() => ddFlagsApi.change('c', 1, { state: 'resolved' }), /Unknown flag state/);
  });
  assert.deepEqual(out, []);
  assert.deepEqual(DD_FLAG_STATES, ['open', 'in_progress', 'condition_to_close', 'accepted', 'closed']);
  assert.equal(api.ddFlagsApi, ddFlagsApi, 'api.js re-exports it');
});
