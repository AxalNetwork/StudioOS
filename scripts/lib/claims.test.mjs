/**
 * D5617: `claims.mjs` and `../claim.mjs`: claim metadata round trips and TTL
 * expiry, one winner between two concurrent acquisitions, renew and release,
 * comment-only reaping, the 403 label fallback, and the WIP cap.
 */
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
    if (path === 'issues/5617') return { number: 5617, title: 'Task', body: '', state: 'open', user: { type: 'User' } };
    if (path.startsWith('issues?state=open&labels=scan%3Abatch')) return [];
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

test('reap reads an unpaginated matching-ref list above 100 and still paginates comments', async () => {
  const refs = Array.from({ length: 101 }, (_, i) => ({ ref: claimRef(10000 + i), object: { sha: `ref-${i}` } }));
  const comments = Array.from({ length: 100 }, (_, i) => ({ body: `Existing comment ${i}` }));
  const writes = [];
  let refReads = 0;
  const api = async (method, path, body) => {
    if (path.startsWith('git/matching-refs/heads/claim/')) {
      refReads++;
      // GitHub's matching-refs endpoint ignores page/per_page and returns the complete match list.
      return refs;
    }
    if (path.startsWith('git/commits/')) {
      const i = Number(path.split('-').at(-1));
      return { message: claimMessage({ ...identity, issue: 10000 + i, at: i === 100 ? at : '2026-11-12T00:00:00Z' }) };
    }
    if (method === 'GET' && path.startsWith('issues/10100/comments')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page') || 1);
      return comments.slice((page - 1) * 100, page * 100);
    }
    writes.push({ method, path, body });
    if (method === 'POST' && path === 'issues/10100/comments') { comments.push(body); return {}; }
    throw new Error('Unexpected write: ' + method + ' ' + path);
  };
  for (let i = 0; i < 2; i++) {
    assert.equal(await runClaim({ ...identity, api, command: 'reap', now: '2026-11-12T00:00:00Z' }), 0);
  }
  assert.equal(refReads, 2, 'one complete matching-ref read per run');
  assert.equal(comments.length, 101, 'the marker on comment page two prevents a duplicate notice');
  assert.deepEqual(writes.map(({ method, path }) => [method, path]), [['POST', 'issues/10100/comments']]);
});

test('claim reports WIP, blocks before writes at the cap, and proceeds when unset', async () => {
  const f = fake();
  const output = [];
  const options = { ...identity, ...f, command: 'claim', log: value => output.push(value),
    wipReport: async () => new Map([['S39', { pulls: [
      { number: 123, state: 'draft', weight: 1 }, { number: 124, state: 'green', weight: 1 },
    ], expired: [] }]]) };
  assert.equal(await runClaim({ ...options, wipCap: '1' }), 5);
  assert.deepEqual(f.writes, []);
  assert.match(output.at(-1), /finish #123 before claiming/);
  assert.doesNotMatch(output.at(-1), /#124/);
  assert.equal(await runClaim(options), 0);
});

test('a report outage is advisory with no cap and stops an enforced claim', async () => {
  const f = fake();
  const options = { ...identity, ...f, command: 'claim', wipReport: async () => { throw Object.assign(new Error('offline'), { status: 403 }); } };
  await assert.rejects(runClaim({ ...options, wipCap: '3' }), /offline/);
  assert.deepEqual(f.writes, []);
  assert.equal(await runClaim(options), 0);
});

// D7259: a Code Scanning remediation batch claim holds its open members; a held batch refuses their claims.
const batchBody = (members, resolved = []) => [
  '<!-- studioos-scan-remediation-batch:0a1b2c3d -->', '', '## Members', '',
  ...members.map(n => `- #${n} · [alert #${n - 500}](https://github.com/AxalNetwork/StudioOS/security/code-scanning/${n - 500})`),
  '', '## Resolved members', '',
  ...resolved.map(n => `- #${n} · [alert #${n - 500}](https://github.com/AxalNetwork/StudioOS/security/code-scanning/${n - 500})`),
].join('\n');
function batchFake({ members = [501, 502], resolved = [], author = { type: 'Bot', login: 'axal-scan[bot]' } } = {}) {
  const refs = new Map(), commits = { main: { tree: { sha: 'tree' }, message: '' } }, writes = [];
  let n = 0;
  const issues = new Map([[900, { number: 900, title: '[Code Scanning] Remediation batch 0a1b2c3d', state: 'open',
    labels: [{ name: 'scan:batch' }], body: batchBody(members, resolved), user: author }]]);
  const fail = status => { throw Object.assign(new Error('HTTP ' + status), { status }); };
  // Every call yields, so concurrent runs interleave between reads and writes.
  const api = async (method, path, body) => {
    await new Promise(resolve => setImmediate(resolve));
    if (method !== 'GET') writes.push({ method, path, body });
    if (path === 'git/ref/heads/main') return { object: { sha: 'main' } };
    const issue = /^issues\/(\d+)$/.exec(path)?.[1];
    if (issue) return issues.get(Number(issue)) ?? { number: Number(issue), title: 'Tracker', body: '', state: 'open', user: { type: 'Bot' } };
    if (path.startsWith('issues?state=open&labels=scan%3Abatch')) return [...issues.values()].filter(i => i.state === 'open');
    const held = /^git\/ref\/heads\/claim\/(\d+)$/.exec(path)?.[1];
    if (held) return refs.has(Number(held)) ? { object: { sha: refs.get(Number(held)) } } : fail(404);
    if (path.startsWith('git/commits/')) return commits[path.split('/').at(-1)];
    if (path === 'git/commits') { const sha = 'c' + ++n; commits[sha] = { ...body, tree: { sha: body.tree } }; return { sha }; }
    if (path === 'git/refs') {
      const number = Number(body.ref.split('/').at(-1));
      if (refs.has(number)) fail(422);
      refs.set(number, body.sha); return {};
    }
    const target = Number(path.split('/').at(-1));
    if (method === 'DELETE') { refs.delete(target); return null; }
    if (method === 'PATCH') {
      if (commits[body.sha].parents[0] !== refs.get(target)) fail(422);
      refs.set(target, body.sha); return {};
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  const holder = number => refs.has(number) ? parseClaim(commits[refs.get(number)].message) : null;
  return { api, refs, writes, issues, holder };
}
const agentA = { slot: 'S21', agent: 'Claude Code', session: 'a', now: at, log() {} };
const agentB = { ...agentA, session: 'b' };

test('a batch claim holds each open member, and a held batch refuses a member claim', async () => {
  const f = batchFake({ resolved: [503] });
  const output = [];
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900', log: value => output.push(value) }), 0);
  assert.deepEqual([...f.refs.keys()].sort(), [501, 502, 900], 'a resolved member is not claimed');
  assert.deepEqual([f.holder(501).batch, f.holder(501).session, f.holder(900).batch], [900, 'a', undefined]);
  assert.deepEqual(output.at(-1), { batch: 900, members: [501, 502], heldElsewhere: [] });
  // A member with no ref of its own (it joined the batch after the claim) is still refused.
  f.refs.delete(502);
  const refused = [];
  assert.equal(await runClaim({ ...agentB, api: f.api, command: 'claim', issue: '502', log: value => refused.push(value) }), 3);
  assert.equal(refused.at(-1).batch, 900);
  assert.equal(f.refs.has(502), false, 'the refused claim wrote no ref');
  assert.equal(await runClaim({ ...agentB, api: f.api, command: 'claim', issue: '501' }), 3);
});

test('a member claimed first stays with its holder; the batch claim takes only the rest', async () => {
  const f = batchFake();
  assert.equal(await runClaim({ ...agentB, api: f.api, command: 'claim', issue: '502' }), 0);
  const output = [];
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900', log: value => output.push(value) }), 0);
  assert.deepEqual(output.at(-1), { batch: 900, members: [501], heldElsewhere: [502] });
  assert.equal(f.holder(502).session, 'b');
  assert.equal(f.holder(502).batch, undefined);
});

test('two agents racing for one batch have one winner, and the loser writes no member ref', async () => {
  for (let round = 0; round < 5; round++) {
    const f = batchFake();
    const codes = await Promise.all([
      runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900' }),
      runClaim({ ...agentB, api: f.api, command: 'claim', issue: '900' }),
    ]);
    assert.deepEqual([...codes].sort(), [0, 3]);
    const winner = f.holder(900).session;
    assert.deepEqual([f.holder(501).session, f.holder(502).session], [winner, winner]);
  }
});

test('a batch claim racing a member claim leaves every member ref with exactly one consistent holder', async () => {
  const outcomes = new Set();
  for (let round = 0; round < 12; round++) {
    const f = batchFake();
    const batchLog = [];
    // Stagger the member claim so it starts before, during and after the batch claim's writes.
    const member = (async () => {
      for (let i = 0; i < round; i++) await new Promise(resolve => setImmediate(resolve));
      return runClaim({ ...agentB, api: f.api, command: 'claim', issue: '502' });
    })();
    const [batchCode, memberCode] = await Promise.all([
      runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900', log: value => batchLog.push(value) }), member]);
    assert.equal(batchCode, 0);
    const result = batchLog.at(-1);
    if (memberCode === 0) {
      assert.equal(f.holder(502).session, 'b');
      assert.deepEqual(result.heldElsewhere, [502]);
    } else {
      assert.equal(memberCode, 3);
      assert.equal(f.holder(502).session, 'a');
      assert.deepEqual(result.members, [501, 502]);
    }
    outcomes.add(memberCode);
  }
  assert.deepEqual([...outcomes].sort(), [0, 3], 'both orders were exercised');
});

test('a member ref another session wins between the batch read and write stays with that session', async () => {
  const f = batchFake();
  const api = async (method, path, body) => {
    if (method === 'POST' && path === 'git/refs' && body.ref === claimRef(502) && !f.refs.has(502)) {
      // Session b passed its batch check before the batch ref existed and lands its own ref first.
      const commit = await f.api('POST', 'git/commits', { message: claimMessage({ ...agentB, issue: 502, at }), tree: 'tree', parents: ['main'] });
      await f.api('POST', 'git/refs', { ref: claimRef(502), sha: commit.sha });
    }
    return f.api(method, path, body);
  };
  const output = [];
  assert.equal(await runClaim({ ...agentA, api, command: 'claim', issue: '900', log: value => output.push(value) }), 0);
  assert.deepEqual(output.at(-1), { batch: 900, members: [501], heldElsewhere: [502] });
  assert.equal(f.holder(502).session, 'b');
});

test('batch renew takes new members; release removes only refs this batch claim wrote', async () => {
  const f = batchFake();
  await runClaim({ ...agentB, api: f.api, command: 'claim', issue: '502' });
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900' }), 0);
  f.issues.get(900).body = batchBody([501, 502, 504]);
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'renew', issue: '900', now: '2026-11-11T02:00:00Z' }), 0);
  assert.equal(f.holder(504).batch, 900);
  assert.equal(f.holder(501).at, '2026-11-11T02:00:00.000Z', 'a held member is renewed with its batch');
  assert.equal(await runClaim({ ...agentB, api: f.api, command: 'release', issue: '900' }), 3);
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'release', issue: '900' }), 0);
  assert.deepEqual([...f.refs.keys()], [502], 'the other session keeps its own member claim');
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'claim', issue: '501' }), 0, 'a released batch frees its members');
});

test('an issue a person wrote with the batch title and marker is an ordinary task', async () => {
  const f = batchFake({ author: { type: 'User', login: 'someone' } });
  assert.equal(await runClaim({ ...agentA, api: f.api, command: 'claim', issue: '900' }), 0);
  assert.deepEqual([...f.refs.keys()], [900]);
  assert.equal(await runClaim({ ...agentB, api: f.api, command: 'claim', issue: '501' }), 0);
});
