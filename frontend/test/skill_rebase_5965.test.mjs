// D4538 part 5 (#5965): the rebase client sends the reviewed choices and hash to the mounted Worker route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';

test('5965: rebase client encodes uid and preserves explicit choices, target and expected draft hash', async () => {
  const previousFetch = globalThis.fetch, storage = globalThis.localStorage;
  if (!storage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sent = [], body = { version: 5, expected_draft_hash: 'a'.repeat(64), resolutions: { steps: { choice: 'edit', value: ['Synthetic combined step'] }, tools: { choice: 'axal' } } };
  globalThis.fetch = async (url, options) => { sent.push({ url: String(url), options }); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ skill: { uid: 'synthetic' } }) }; };
  try {
    const r = await teamAgentsApi.rebaseSkill('synthetic/uid', body);
    assert.deepEqual(r, { skill: { uid: 'synthetic' } });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/teams\/skills\/synthetic%2Fuid\/rebase$/);
    assert.equal(sent[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(sent[0].options.body), body);
  } finally { globalThis.fetch = previousFetch; if (!storage) globalThis.localStorage = storage; }
});
