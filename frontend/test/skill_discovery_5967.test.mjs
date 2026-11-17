// D4538 part 6 (#5967): the discovery client posts the contract's request, unchanged, to the mounted Worker route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';

test('5967: discoverSkills posts the request body to /teams/skills/discover', async () => {
  const previousFetch = globalThis.fetch, storage = globalThis.localStorage;
  if (!storage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sent = [], body = { task: 'Months of runway', agent_uid: 'a'.repeat(32), output_kind: 'brief', taxonomy_focus: ['fp_and_a'], workflow_context: null, limit: 3 };
  globalThis.fetch = async (url, options) => { sent.push({ url: String(url), options }); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ outcome: 'no_suitable_skill' }) }; };
  try {
    const r = await teamAgentsApi.discoverSkills(body);
    assert.deepEqual(r, { outcome: 'no_suitable_skill' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/teams\/skills\/discover$/);
    assert.equal(sent[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(sent[0].options.body), body);
  } finally { globalThis.fetch = previousFetch; if (!storage) globalThis.localStorage = storage; }
});
