/** #6766 — Exercise the branch deletion job with a simulated GitHub API. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileFunction } from 'node:vm';

const workflow = readFileSync(new URL('../../.github/workflows/pr-preview.yml', import.meta.url), 'utf8');
const job = workflow.split('\n  delete-merged-branch:\n')[1].split('\n  build:\n')[0];
const source = job.split('          script: |\n')[1].replace(/^ {12}/gm, '');
const run = compileFunction('return (async () => {\n' + source + '\n})()', ['github', 'context', 'core']);
const sha = 'a'.repeat(40);
const branch = 'agent/codex/example';
const ref = { name: branch, protected: false, commit: { sha } };

async function simulate({ name = branch, reads = [ref], openHead = [], openBase = [], failure } = {}) {
  const updates = [];
  const github = {
    rest: {
      repos: { async getBranch(args) {
        assert.deepEqual(args, { owner: 'AxalNetwork', repo: 'StudioOS', branch: name });
        const value = reads.shift();
        if (value instanceof Error) throw value;
        assert.ok(value, 'unexpected branch read');
        return { data: value };
      } },
      pulls: { async list(args) {
        assert.equal(args.state, 'open');
        assert.equal(args.per_page, 1);
        if (args.base === name) return { data: openBase };
        assert.equal(args.head, 'AxalNetwork:' + name);
        return { data: openHead };
      } },
    },
    async graphql(query, input) {
      assert.match(query, /updateRefs\(input: \$input\)/);
      updates.push(input);
      if (failure) throw failure;
    },
  };
  const context = {
    repo: { owner: 'AxalNetwork', repo: 'StudioOS' },
    payload: {
      repository: { node_id: 'repo-id', default_branch: 'default' },
      pull_request: { head: { ref: name, sha }, merge_commit_sha: 'f'.repeat(40) },
    },
  };
  await run(github, context, { info() {} });
  return updates;
}

test('only a closed, merged, same-repository PR into main can start the write job', () => {
  for (const condition of [
    "github.event.action == 'closed'", 'github.event.pull_request.merged == true',
    "github.event.pull_request.base.ref == 'main'", "github.ref == 'refs/heads/main'",
    'github.event.pull_request.head.repo.id == github.event.repository.id',
  ]) assert.ok(job.includes(condition));
  assert.match(job, /permissions:\n      contents: write\n      pull-requests: read\n/);
  assert.doesNotMatch(job, /secrets\.|actions\/checkout|pull_request_target/);
});

test('squash and queue merges delete only the original PR head using an atomic comparison', async () => {
  assert.deepEqual(await simulate(), [{ input: { repositoryId: 'repo-id', refUpdates: [{
    name: 'refs/heads/' + branch, beforeOid: sha, afterOid: '0'.repeat(40),
  }] } }]);
});

test('keeps reserved, protected, moved and reused branches and ignores an absent branch', async () => {
  for (const name of ['main', 'default', 'claim/42', 'gh-readonly-queue/main/pr-42']) {
    assert.deepEqual(await simulate({ name, reads: [] }), []);
  }
  const missing = Object.assign(new Error('Not found'), { status: 404 });
  for (const current of [missing, { ...ref, protected: true }, { ...ref, name: 'renamed' },
    { ...ref, commit: { sha: 'b'.repeat(40) } }]) {
    assert.deepEqual(await simulate({ reads: [current] }), []);
  }
  for (const open of [{ openHead: [{}] }, { openBase: [{}] }]) {
    assert.deepEqual(await simulate(open), []);
  }
});

test('reports genuine API failures and tolerates concurrent deletion or a new commit', async () => {
  const failure = new Error('GitHub API refused the update');
  await assert.rejects(simulate({ reads: [failure] }), failure);
  await assert.rejects(simulate({ reads: [ref, ref], failure }), failure);
  for (const concurrent of [
    Object.assign(new Error('gone'), { status: 404 }), { ...ref, commit: { sha: 'b'.repeat(40) } },
  ]) {
    assert.equal((await simulate({ reads: [ref, concurrent], failure })).length, 1);
  }
});
