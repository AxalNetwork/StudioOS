import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullRunValid, MAX_BASE_COMMITS, tierFor } from '../../scripts/lib/prTier.mjs';

const headSha = '1'.repeat(40);
const mainSha = '2'.repeat(40);
const pullRequest = {
  event: 'pull_request',
  fork: false,
  headSha,
  selection: { mode: 'selected', files: ['frontend/test/example.test.mjs'] },
};

test('a same-repository PR with a usable selection runs rest and selected', () => {
  const thin = { mode: 'thin', reason: 'selected', parts: ['rest', 'selected'] };
  assert.deepEqual(tierFor(pullRequest), thin);
  assert.deepEqual(tierFor({
    ...pullRequest, selection: { mode: 'selected', files: [] },
  }), thin);
});

test('queue, push, dispatch and unknown events use the full planner', () => {
  for (const event of ['merge_group', 'push', 'workflow_dispatch', 'schedule', undefined]) {
    assert.deepEqual(tierFor({ ...pullRequest, event }), {
      mode: 'full', reason: 'event', parts: null,
    });
  }
});

test('forks, unknown heads, and missing or invalid selections run full', () => {
  for (const overrides of [
    { fork: true }, { fork: undefined }, { headSha: '1234' },
    { selection: undefined }, { selection: { mode: 'full' } },
    { selection: { mode: 'selected', files: [''] } },
    { selection: { mode: 'selected', files: Array(1) } },
  ]) {
    assert.equal(tierFor({ ...pullRequest, ...overrides }).mode, 'full');
  }
});

test('a sampled SHA always runs the full audit', () => {
  const audit = { ...pullRequest, headSha: '0'.repeat(39) + '8' };
  assert.deepEqual(tierFor(audit), { mode: 'full', reason: 'audit', parts: null });
  assert.deepEqual(tierFor({ ...audit, selection: { mode: 'selected', files: [] } }),
    { mode: 'full', reason: 'audit', parts: null });
});

const run = {
  id: 123, attempt: 2, repositoryId: 10, workflowId: 20,
  event: 'workflow_dispatch', conclusion: 'success', headSha,
};
const gate = {
  name: 'landing gate', conclusion: 'success', fullSuiteVerified: true,
  headSha, runId: 123, attempt: 2,
};
const base = {
  sha: '3'.repeat(40), mainSha, ancestorOfMain: true,
  commitsBehind: MAX_BASE_COMMITS - 1, minutesBehind: 120, runId: 123, attempt: 2,
};
const proof = { headSha, mainSha, repositoryId: 10, workflowId: 20, run, gate, base };

test('the full dispatch gate accepts an exact-head, fresh base at the limit', () => {
  assert.equal(fullRunValid(proof), true);
  assert.equal(fullRunValid({
    ...proof, base: { ...base, sha: mainSha, commitsBehind: 0, minutesBehind: 0 },
  }), true);
});

test('the full dispatch gate rejects a wrong SHA, failed run, and other CI producers', () => {
  for (const changes of [
    { headSha: mainSha }, { conclusion: 'failure' }, { event: 'pull_request' },
    { event: 'merge_group' }, { event: 'push' }, { repositoryId: 11 }, { workflowId: 21 },
  ]) {
    assert.equal(fullRunValid({ ...proof, run: { ...run, ...changes } }), false);
  }
  for (const changes of [
    { attempt: 1 }, { runId: 124 }, { headSha: mainSha },
    { fullSuiteVerified: false }, { conclusion: 'skipped' },
  ]) {
    assert.equal(fullRunValid({ ...proof, gate: { ...gate, ...changes } }), false);
  }
});

test('the full dispatch gate rejects stale, unbound, or missing base evidence', () => {
  for (const changes of [
    { commitsBehind: MAX_BASE_COMMITS }, { minutesBehind: 121 }, { ancestorOfMain: false },
    { mainSha: headSha }, { commitsBehind: 0 }, { attempt: 1 }, { runId: 124 },
  ]) {
    assert.equal(fullRunValid({ ...proof, base: { ...base, ...changes } }), false);
  }
  assert.equal(fullRunValid({ ...proof, base: undefined }), false);
});


test('#6460 draft pull requests run rest only and the draft bit does not narrow push or queue events', () => {
  assert.deepEqual(tierFor({ ...pullRequest, draft: true }), {
    mode: 'draft', reason: 'draft', parts: ['rest'],
  });
  assert.deepEqual(tierFor({ ...pullRequest, draft: false }), tierFor(pullRequest));
  for (const event of ['push', 'merge_group']) {
    assert.deepEqual(tierFor({ ...pullRequest, event, draft: true }),
      { mode: 'full', reason: 'event', parts: null });
  }
});
