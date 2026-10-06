/**
 * D545 — the client for the community task list is its own module (D527),
 * re-exported by api.js, and calls the Worker route the Tasks panel reads.
 * The route itself is driven in cloudflare-worker/test/community_tasks_d545.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// `request()` reads the auth token, the active company and the CSRF cookie on
// its way out. Signed out, no company, no cookie.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { cookie: '' };

test('communityTasksApi.list GETs /api/community-tasks and hands back the body', async () => {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify({ tasks: [], my_suggestions: [], audience: 'founder' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { communityTasksApi } = await import('../src/lib/api.js');
    const body = await communityTasksApi.list();
    assert.deepEqual(body, { tasks: [], my_suggestions: [], audience: 'founder' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/community-tasks$/);
    assert.equal(calls[0].method, 'GET');
    await communityTasksApi.list(4521);
    assert.match(calls[1].url, /\/api\/community-tasks\?suggestions_before=4521$/, 'the next page of suggestions');
  } finally { globalThis.fetch = origFetch; }
});
