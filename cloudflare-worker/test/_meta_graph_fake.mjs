import assert from 'node:assert/strict';

export function fakeMetaGraph(t, reply) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://graph.facebook.com');
    calls.push({ path: target.pathname, method: init?.method });
    return Response.json(await reply(target, init));
  });
  return calls;
}
