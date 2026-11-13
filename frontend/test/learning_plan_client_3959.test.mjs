/**
 * #3959: the learning plan client calls the routes the Worker test
 * (cloudflare-worker/test/learning_plan_3959.test.ts) holds, with these paths,
 * verbs and bodies, and api.js re-exports it (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { learningPlanApi } = await import('../src/lib/api/learningPlan.js');
const { learningPlanApi: viaApi } = await import('../src/lib/api.js');

test('the plan: paths, verbs and bodies', async () => {
  // Mutation checked: the uid left unencoded → the update path differs; markDone without /done → the last path differs.
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ?? null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await learningPlanApi.list({ from: '2030-01-01T00:00:00.000Z', to: '2030-02-01T00:00:00.000Z' });
    await learningPlanApi.list();
    await learningPlanApi.create({ item_kind: 'study_block', starts_at: '2030-01-07T09:00:00.000Z' });
    await learningPlanApi.update('a b/c', { status: 'skipped' });
    await learningPlanApi.remove('p1');
    await learningPlanApi.markDone('p1');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/learning/plan?from=2030-01-01T00%3A00%3A00.000Z&to=2030-02-01T00%3A00%3A00.000Z', null],
    ['GET', '/api/learning/plan', null],
    ['POST', '/api/learning/plan', JSON.stringify({ item_kind: 'study_block', starts_at: '2030-01-07T09:00:00.000Z' })],
    ['PATCH', '/api/learning/plan/a%20b%2Fc', JSON.stringify({ status: 'skipped' })],
    ['DELETE', '/api/learning/plan/p1', null],
    ['POST', '/api/learning/plan/p1/done', null],
  ]);
  assert.equal(viaApi, learningPlanApi, 'api.js re-exports the module (D527)');
});
