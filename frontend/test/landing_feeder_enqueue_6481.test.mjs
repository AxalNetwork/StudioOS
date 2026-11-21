import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueCandidate } from '../../scripts/landing-bot/feeder-enqueue.mjs';

const sha = 'a'.repeat(40);
const candidate = { number: 315, pullRequestId: 'PR_315', expectedHeadOid: sha };
const token = 'test-installation-token';
const pr = { id: 'PR_315', number: 315, headRefOid: sha };
const queueEntry = { id: 'MQE_315', jump: false, pullRequest: pr };
const success = entry => ({ data: { enqueuePullRequest: { mergeQueueEntry: entry } } });
const reply = body => new Response(JSON.stringify(body));

test('the sole write enqueues the pinned PR without jumping', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const { query, variables } = JSON.parse(options.body);
    assert.deepEqual(variables, { pullRequestId: 'PR_315', expectedHeadOid: sha });
    assert.match(query, /enqueuePullRequest\(input:\s*\{\s*pullRequestId: \$pullRequestId, expectedHeadOid: \$expectedHeadOid, jump: false\s*\}\)/);
    assert.doesNotMatch(query, /mergePullRequest|enablePullRequestAutoMerge|addPullRequestReview/);
    return reply(success(queueEntry));
  };
  const result = await enqueueCandidate(candidate, { appToken: token, fetchImpl });
  assert.deepEqual(result, { number: 315, expectedHeadOid: sha, status: 'queued', entryId: 'MQE_315' });
  assert.equal(calls, 1);
});

test('a refused exact-head mutation is reported without trying the newer head', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return reply({ data: { enqueuePullRequest: null }, errors: [
      { type: 'UNPROCESSABLE', path: ['enqueuePullRequest'], message: 'Head changed' },
    ] });
  };
  assert.equal((await enqueueCandidate(candidate, { appToken: token, fetchImpl })).status, 'refused');
  assert.equal(calls, 1);
});

test('uncertain writes neither retry nor expose remote error or credential text', async () => {
  const cases = [
    () => { throw new Error(token); },
    () => new Response(token, { status: 502 }),
    () => new Response(token),
    () => reply({ data: { enqueuePullRequest: null }, errors: [
      { type: 'FORBIDDEN', path: ['enqueuePullRequest', 'mergeQueueEntry', 'pullRequest'], message: token },
    ] }),
    () => reply({ ...success(queueEntry), errors: [{ message: token }] }),
    () => reply(success(null)),
    () => reply(success({ ...queueEntry, id: '' })),
    () => reply(success({ ...queueEntry, jump: true })),
    () => reply(success({ ...queueEntry, pullRequest: { ...pr, headRefOid: 'b'.repeat(40) } })),
    () => reply(success({ ...queueEntry, pullRequest: { ...pr, id: 'PR_other' } })),
    () => reply(success({ ...queueEntry, pullRequest: { ...pr, number: 316 } })),
  ];
  for (const response of cases) {
    let calls = 0;
    const fetchImpl = async () => { calls++; return response(); };
    const result = await enqueueCandidate(candidate, { appToken: token, fetchImpl });
    assert.equal(result.status, 'unconfirmed');
    assert.ok(!JSON.stringify(result).includes(token));
    assert.equal(calls, 1);
  }
});

test('invalid identity, SHA or token fails before any request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; };
  for (const [patch, appToken] of [
    [{ number: 0 }, token], [{ pullRequestId: '' }, token], [{ expectedHeadOid: 'abc' }, token], [{}, ''],
  ]) {
    await assert.rejects(enqueueCandidate({ ...candidate, ...patch }, { appToken, fetchImpl }), TypeError);
  }
  assert.equal(calls, 0);
});
