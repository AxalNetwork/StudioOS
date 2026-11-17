// D5970 (#5970): `adminHqSkillsApi.list` passes the library read's filters through as query parameters, on the
// existing method. Without filters it calls the same path as before; the Worker validates every value.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_skill_filters_5970.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { adminHqSkillsApi } = await import('../src/lib/api/adminHqSkills.js');

async function sent(call) {
  const before = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ skills: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { await call(); } finally { globalThis.fetch = before; }
  return urls;
}

test('D5970: list without filters calls the bare library path, as before', async () => {
  for (const call of [() => adminHqSkillsApi.list(), () => adminHqSkillsApi.list({}), () => adminHqSkillsApi.list(undefined, {})]) {
    const [url] = await sent(call);
    assert.match(url, /\/api\/admin\/ai-agents\/skills$/);
  }
});

test('D5970: list passes each given filter through, and leaves out the ones not given', async () => {
  const [url] = await sent(() => adminHqSkillsApi.list({}, { role: 'cfo', version: 2, from: '2026-11-01', to: '2026-11-30', model: '@cf/x/y', tag: undefined, uid: null }));
  const u = new URL(url, 'http://local.test');
  assert.equal(u.pathname, '/api/admin/ai-agents/skills');
  // Mutation checked: dropping the `v != null` filter sends tag=undefined and uid=null, and this fails.
  assert.deepEqual([...u.searchParams], [['role', 'cfo'], ['version', '2'], ['from', '2026-11-01'], ['to', '2026-11-30'], ['model', '@cf/x/y']]);
});
