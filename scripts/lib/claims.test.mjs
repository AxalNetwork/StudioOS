import test from 'node:test';
import assert from 'node:assert/strict';
import { claimRef, claimMessage, parseClaim, isExpired } from './claims.mjs';
import { runClaim } from '../claim.mjs';

const at = '2026-11-11T00:00:00.000Z';
const identity = { issue: 5617, slot: 's39', agent: 'Codex', session: '39', now: at, log() {} };
function fake() {
  let ref = null, n = 0;
  const commits = { main: { tree: { sha: 'tree' }, message: '' } };
  const comments = [], writes = [];
  const fail = status => { throw Object.assign(new Error('HTTP ' + status), { status }); };
  const api = async (method, path, body) => {
    if (method !== 'GET') writes.push({ method, path, body });
    if (path === 'git/ref/heads/main') return { object: { sha: 'main' } };
    if (path.startsWith('git/ref/heads/claim/')) return ref ? { object: { sha: ref } } : fail(404);
    if (path.startsWith('git/matching-refs/')) return ref ? [{ ref: claimRef(5617), object: { sha: ref } }] : [];
    if (path.startsWith('git/commits/')) return commits[path.split('/').at(-1)];
    if (path === 'git/commits') { const sha = 'c' + ++n; commits[sha] = { ...body, tree: { sha: body.tree } }; return { sha }; }
    if (path === 'git/refs') { if (ref) fail(422); ref = body.sha; return {}; }
    if (path.startsWith('git/refs/')) {
      if (method === 'DELETE') { ref = null; return null; }
      assert.equal(body.force, false);
      if (commits[body.sha].parents[0] !== ref) fail(422);
      ref = body.sha; return {};
    }
    if (path.includes('/comments')) {
      if (method === 'GET') return comments;
      comments.push(body); return {};
    }
    throw new Error('unexpected ' + path);
  };
  return { api, comments, writes };
}
test('metadata round trips; malformed and TTL boundary are expired', () => {
  const message = claimMessage({ ...identity, at });
  const claim = parseClaim(message);
  assert.equal(claim.session, '39');
  assert.equal(claimRef(5617), 'refs/heads/claim/5617');
  assert.equal(isExpired(claim, '2026-11-11T23:59:59.999Z'), false);
  assert.equal(isExpired(claim, '2026-11-12T00:00:00.000Z'), true);
  for (const value of ['broken', '{}', 'null', '{"version":1}']) assert.equal(isExpired(parseClaim(value), at), true);
  assert.throws(() => claimRef('../main'));
  assert.throws(() => claimMessage({ ...identity, at, ttlHours: -1 }));
});
test('two concurrent acquisitions have exactly one winner, 422 is held', async () => {
  const f = fake();
  const codes = await Promise.all([runClaim({ ...identity, ...f, command: 'claim' }), runClaim({ ...identity, ...f, session: 'other', command: 'claim' })]);
  assert.deepEqual(codes.sort(), [0, 3]);
  assert.equal(await runClaim({ ...identity, ...f, command: 'claim' }), 3);
  assert.equal(f.writes.filter(w => w.path === 'git/refs').length, 2);
});
test('renew uses a child of the held commit and release verifies holder', async () => {
  const f = fake();
  assert.equal(await runClaim({ ...identity, ...f, command: 'claim' }), 0);
  assert.equal(await runClaim({ ...identity, ...f, command: 'release', session: 'other' }), 3);
  assert.equal(await runClaim({ ...identity, ...f, command: 'renew', now: '2026-11-11T01:00:00Z' }), 0);
  assert.equal(await runClaim({ ...identity, ...f, command: 'renew', now: '2026-11-12T02:00:00Z' }), 3);
  assert.equal(await runClaim({ ...identity, ...f, command: 'release' }), 0);
  assert.equal(await runClaim({ ...identity, ...f, command: 'claim' }), 0);
});
test('reap comments once across two runs and never deletes', async () => {
  const f = fake();
  await runClaim({ ...identity, ...f, command: 'claim' });
  for (let i = 0; i < 2; i++) await runClaim({ ...identity, ...f, command: 'reap', now: '2026-11-12T00:00:00Z' });
  assert.equal(f.comments.length, 1);
  assert.match(f.comments[0].body, /<!-- expired-claim:5617:c1 -->/);
  assert.equal(f.writes.some(w => w.method === 'DELETE'), false);
});
test('403 requests explicit label fallback; other API errors propagate', async () => {
  const f = fake();
  const api = async (...args) => { if (args[0] === 'POST') throw Object.assign(new Error('no'), { status: 403 }); return f.api(...args); };
  assert.equal(await runClaim({ ...identity, api, command: 'claim' }), 4);
  assert.equal(await runClaim({ ...identity, api: async () => { throw Object.assign(new Error('read forbidden'), { status: 403 }); }, command: 'claim' }), 4);
  await assert.rejects(runClaim({ ...identity, command: 'claim', api: async () => { throw new Error('offline'); } }), /offline/);
});
